import { randomUUID } from 'node:crypto';
import { enqueueBuild, enqueueRelease, publishRouteInvalidation } from 'core';
import {
  and,
  count,
  deployments,
  desc,
  emitDeploymentEvent,
  eq,
  inArray,
  instances,
  projects,
  withOutbox,
  type ActorSpec,
  type Deployment,
  type Project,
  type ProjectRepository,
} from 'database';
import {
  DeploymentStatus,
  deploymentSubdomain,
  getOrgPlan,
  IN_FLIGHT_DEPLOYMENT_STATUSES,
  type DeploymentConfig,
  type DeploymentEnvironment,
  type ExternalRef,
  type DeploymentTrigger,
  type ProjectType,
} from 'shared';
import { db } from '@/lib/db';
import { ApiError, badRequest, conflict, planLimit } from '../api';
import { getBuildQueue, getRedis, getReleaseQueue } from '../infra';

/** Snapshot of the project's current build/runtime settings, frozen into the deployment. */
export function snapshotConfig(project: Project): DeploymentConfig {
  return {
    type: project.type as ProjectType,
    source: project.sourceType === 'image' ? 'image' : 'git',
    image: project.dockerImage,
    framework: project.framework,
    rootDirectory: project.rootDirectory ?? '',
    installCommand: project.installCommand,
    buildCommand: project.buildCommand,
    startCommand: project.startCommand,
    outputDirectory: project.outputDirectory,
    dockerfilePath: project.dockerfilePath,
    port: project.port,
    healthCheckPath: project.healthCheckPath,
    instancePlan: project.instancePlan,
    instanceCount: project.instanceCount,
    cronSchedule: project.cronSchedule,
  };
}

export interface CreateDeploymentInput {
  project: Project;
  /** `null` for Docker image projects, which are deployed without a repository. */
  repository: ProjectRepository | null;
  orgPlan: string;
  environment: DeploymentEnvironment;
  trigger: DeploymentTrigger;
  branch?: string;
  commitSha?: string | null;
  commitMessage?: string | null;
  commitAuthor?: string | null;
  config?: DeploymentConfig;
  createdBy?: string | null;
  /** Ecosystem connector: caller data, merged over the project's correlation ids (a deployment inherits its project's). */
  metadata?: Record<string, unknown>;
  externalRef?: ExternalRef;
  createdVia?: string;
}

const MAX_QUEUED_PER_PROJECT = 10;

/**
 * Creates the deployment row (with its immutable URL and config snapshot) and queues the build.
 * The job carries only the deployment id: the worker reads everything else (incl. secrets) from Postgres.
 */
export async function createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
  const { project, repository } = input;
  const plan = getOrgPlan(input.orgPlan);

  if (input.environment === 'preview' && !plan.previewDeployments) {
    throw planLimit('Preview deployments are not included in your plan', { kind: 'preview_deployments' });
  }
  if (!project.slug) throw badRequest('Project has no slug');
  const config = input.config ?? snapshotConfig(project);
  const fromImage = config.source === 'image';
  if (fromImage && !config.image) throw badRequest('Project has no Docker image configured');
  if (!fromImage && !repository) throw badRequest('Project has no connected repository');

  const [pending] = await db
    .select({ n: count() })
    .from(deployments)
    .where(and(eq(deployments.projectId, project.id), inArray(deployments.status, [...IN_FLIGHT_DEPLOYMENT_STATUSES])));
  if ((pending?.n ?? 0) >= MAX_QUEUED_PER_PROJECT) {
    throw new ApiError(429, 'Too many deployments are already queued for this project', 'queue_full');
  }

  const id = randomUUID();
  const actor: ActorSpec = input.createdVia === 'connector' ? { kind: 'connector', userId: input.createdBy } : input.createdBy ? { kind: 'user', userId: input.createdBy } : { kind: 'system' };
  const deployment = await withOutbox(db, async (tx) => {
    const [row] = await tx
      .insert(deployments)
      .values({
        id,
        projectId: project.id,
        status: DeploymentStatus.QUEUED,
        environment: input.environment,
        trigger: input.trigger,
        branch: fromImage ? null : (input.branch ?? repository!.branch),
        commitHash: input.commitSha ?? null,
        // Image deployments have no commit: the list shows which image was deployed instead.
        commitMessage: (input.commitMessage ?? (fromImage ? `Docker image ${config.image}` : null))?.slice(0, 1000) ?? null,
        commitAuthor: input.commitAuthor?.slice(0, 255) ?? null,
        subdomain: deploymentSubdomain(project.slug!, id),
        config,
        createdBy: input.createdBy ?? null,
        metadata: input.metadata ?? null,
        externalRef: project.externalRef || input.externalRef ? { ...project.externalRef, ...input.externalRef } : null,
        createdVia: input.createdVia ?? null,
      })
      .returning();
    await emitDeploymentEvent(tx, id, 'queued', actor);
    return row!;
  });

  try {
    await enqueueBuild(getBuildQueue(), id);
  } catch (err) {
    await withOutbox(db, async (tx) => {
      await tx
        .update(deployments)
        .set({ status: DeploymentStatus.FAILED, errorMessage: 'Could not enqueue build', updatedAt: new Date() })
        .where(eq(deployments.id, id));
      await emitDeploymentEvent(tx, id, 'failed');
    });
    throw err;
  }
  return deployment;
}

export async function cancelDeployment(deployment: Deployment, actor: ActorSpec = { kind: 'user' }): Promise<Deployment> {
  if (!IN_FLIGHT_DEPLOYMENT_STATUSES.includes(deployment.status as DeploymentStatus)) {
    throw conflict(`Deployment is already ${deployment.status.toLowerCase()}`);
  }
  // Conditional update: the worker may finish between our read and write. The event is only written when this
  // statement really changed the row, in the same transaction.
  const updated = await withOutbox(db, async (tx) => {
    const [row] = await tx
      .update(deployments)
      .set({ status: DeploymentStatus.CANCELED, errorMessage: 'Canceled by user', updatedAt: new Date() })
      .where(and(eq(deployments.id, deployment.id), inArray(deployments.status, [...IN_FLIGHT_DEPLOYMENT_STATUSES])))
      .returning();
    if (row) await emitDeploymentEvent(tx, deployment.id, 'canceled', actor);
    return row;
  });
  if (!updated) throw conflict('Deployment finished before it could be canceled');
  // A job that has not started yet can simply be dropped; a running build notices the status change.
  try {
    const job = await getBuildQueue().getJob(`build-${deployment.id}`);
    if (job && (await job.isWaiting())) await job.remove();
  } catch {
    /* worker will skip canceled deployments anyway */
  }
  return updated;
}

/**
 * Makes a READY deployment the live one (instant rollback when it is an older deployment).
 * Static sites flip a pointer; container deployments are (re)started by the scheduler first.
 */
export async function promoteDeployment(project: Project, deployment: Deployment, actor: ActorSpec = { kind: 'user' }): Promise<{ queued: boolean }> {
  if (deployment.projectId !== project.id) throw badRequest('Deployment does not belong to this project');
  if (deployment.status !== DeploymentStatus.READY) throw conflict('Only deployments that are ready can be promoted');

  const type = (deployment.config?.type ?? project.type) as ProjectType;
  if (type === 'static') {
    await withOutbox(db, async (tx) => {
      await tx.update(projects).set({ currentDeploymentId: deployment.id, updatedAt: new Date() }).where(eq(projects.id, project.id));
      if (project.currentDeploymentId !== deployment.id) {
        await emitDeploymentEvent(tx, deployment.id, 'promoted', actor, { previousDeploymentId: project.currentDeploymentId });
      }
    });
    await publishRouteInvalidation(getRedis(), { projectId: project.id });
    return { queued: false };
  }
  await enqueueRelease(getReleaseQueue(), deployment.id, true);
  return { queued: true };
}

export async function listDeployments(projectId: string, limit = 30): Promise<Deployment[]> {
  return db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.createdAt))
    .limit(Math.min(limit, 100));
}

export async function runningInstances(deploymentId: string) {
  return db
    .select()
    .from(instances)
    .where(and(eq(instances.deploymentId, deploymentId), inArray(instances.status, ['STARTING', 'RUNNING', 'UNHEALTHY'])));
}
