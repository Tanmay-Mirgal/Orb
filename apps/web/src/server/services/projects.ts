import { randomBytes } from 'node:crypto';
import { encryptSecret, publishRouteInvalidation } from 'core';
import {
  and,
  count,
  deployments,
  environmentVariables,
  eq,
  emitProjectEvent,
  emitProjectEventById,
  inArray,
  instances,
  ne,
  projectRegistryCredentials,
  projectRepositories,
  projects,
  withOutbox,
  type ActorSpec,
  type Deployment,
  type Executor,
  type Organization,
  type Project,
  type ProjectRepository,
} from 'database';
import {
  getInstancePlan,
  getOrgPlan,
  isReservedSlug,
  parseImageReference,
  slugify,
  type CreateProjectInput,
  type RegistryCredentialsInput,
  type UpdateProjectInput,
  type DeploymentTrigger,
  type ExternalRef,
  type ProjectType,
} from 'shared';
import { db } from '@/lib/db';
import { ApiError, badRequest, planLimit } from '../api';
import { getMaintenanceQueue, getRedis } from '../infra';
import { getRepo, getUserGithubToken } from '../github';
import { createDeployment } from './deployments';

function assertWithinPlan(org: Organization, input: { instancePlan?: string; instanceCount?: number; previewDeployments?: boolean; type?: ProjectType | string }) {
  const plan = getOrgPlan(org.plan);
  if (input.instancePlan && !plan.allowedInstancePlans.includes(input.instancePlan)) {
    throw planLimit(`The ${getInstancePlan(input.instancePlan).name} instance size is not available on your ${plan.name} plan`, { kind: 'instance_size' });
  }
  if (input.instanceCount && input.instanceCount > plan.maxInstancesPerService) {
    throw planLimit(`Your ${plan.name} plan allows up to ${plan.maxInstancesPerService} instance(s) per service`, { limit: plan.maxInstancesPerService, kind: 'instances' });
  }
  if (input.previewDeployments && !plan.previewDeployments) {
    throw planLimit('Preview deployments are not included in your plan', { kind: 'preview_deployments' });
  }
}

async function uniqueProjectSlug(name: string): Promise<string> {
  const base = slugify(name, 36);
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 && !isReservedSlug(base) ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const taken = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
    if (taken.length === 0) return slug;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

/**
 * Stores (or, with `null`, removes) the login a Docker image project uses to pull from a private registry.
 * The login is bound to the registry host of `image`; the worker presents it to that host only.
 */
async function saveRegistryCredentials(
  executor: Pick<typeof db, 'insert' | 'delete'>,
  projectId: string,
  credentials: RegistryCredentialsInput | null,
  image: string | null,
): Promise<void> {
  if (!credentials) {
    await executor.delete(projectRegistryCredentials).where(eq(projectRegistryCredentials.projectId, projectId));
    return;
  }
  const registry = image ? parseImageReference(image)?.registry : undefined;
  if (!registry) throw badRequest('Set a valid Docker image before adding a registry login');
  const password = encryptSecret(credentials.password, `${projectId}:registry`);
  await executor
    .insert(projectRegistryCredentials)
    .values({ projectId, registry, username: credentials.username, password })
    .onConflictDoUpdate({ target: projectRegistryCredentials.projectId, set: { registry, username: credentials.username, password, updatedAt: new Date() } });
}

/** Provenance and correlation stored by the ecosystem connector; absent for projects created in the dashboard. */
export interface CreationExtras {
  metadata?: Record<string, unknown>;
  externalRef?: ExternalRef;
  createdVia?: string;
  /** How the first deployment is recorded. Defaults to `manual`. */
  trigger?: DeploymentTrigger;
}

export async function createProject(options: {
  userId: string;
  org: Organization;
  input: CreateProjectInput;
  extras?: CreationExtras;
}): Promise<{ project: Project; repository: ProjectRepository | null; deployment: Deployment | null }> {
  const { userId, org, input, extras } = options;
  const plan = getOrgPlan(org.plan);
  const isImage = input.source === 'image';

  const [existing] = await db.select({ n: count() }).from(projects).where(eq(projects.orgId, org.id));
  if ((existing?.n ?? 0) >= plan.maxProjects) {
    throw planLimit(`Your ${plan.name} plan allows up to ${plan.maxProjects} projects`, { limit: plan.maxProjects, kind: 'projects' });
  }
  assertWithinPlan(org, input);
  const type = input.type as ProjectType;
  if (type === 'cron' && !input.cronSchedule) throw badRequest('Cron jobs need a schedule');
  if (type !== 'static') {
    // Containers are what costs money (RAM, CPU, disk); static sites only use object storage.
    const [containers] = await db
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.orgId, org.id), ne(projects.type, 'static')));
    if ((containers?.n ?? 0) >= plan.maxContainerProjects) {
      throw planLimit(
        `Your ${plan.name} plan includes ${plan.maxContainerProjects} web service / worker / cron project${plan.maxContainerProjects === 1 ? '' : 's'}. Static sites are not counted. Upgrade for more.`,
        { limit: plan.maxContainerProjects, kind: 'container_projects' },
      );
    }
  }

  if (!isImage && input.port === 0) throw badRequest('Port must be between 1 and 65535');
  if (isImage && type !== 'static' && input.previewDeployments) throw badRequest('Preview deployments need a Git repository');

  // Trust GitHub, not the browser: confirm the user can read the repository and take canonical identifiers from it.
  // Docker image projects have no repository: the image is pulled by the worker, which validates it again.
  const repo = isImage ? null : await getRepo(await getUserGithubToken(userId), input.repository!.fullName);

  const slug = await uniqueProjectSlug(input.name);
  const created = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        name: input.name,
        slug,
        userId,
        orgId: org.id,
        type,
        sourceType: isImage ? 'image' : 'git',
        dockerImage: isImage ? input.image : null,
        framework: isImage ? 'Docker image' : input.framework,
        rootDirectory: isImage ? '' : (input.rootDirectory ?? ''),
        installCommand: isImage ? null : input.installCommand,
        buildCommand: isImage ? null : input.buildCommand,
        startCommand: input.startCommand,
        outputDirectory: isImage ? null : (input.outputDirectory ?? (type === 'static' ? 'dist' : null)),
        dockerfilePath: isImage ? null : input.dockerfilePath,
        // 0 = auto: the worker reads the port the image declares with EXPOSE.
        port: isImage ? (input.port ?? 0) : (input.port ?? 3000),
        healthCheckPath: input.healthCheckPath ?? '/',
        instancePlan: input.instancePlan ?? 'free',
        instanceCount: input.instanceCount ?? 1,
        cronSchedule: input.cronSchedule,
        autoDeploy: isImage ? false : (input.autoDeploy ?? true),
        previewDeployments: input.previewDeployments ?? false,
        metadata: extras?.metadata ?? null,
        externalRef: extras?.externalRef ?? null,
        createdVia: extras?.createdVia ?? null,
      })
      .returning();
    let repository: ProjectRepository | null = null;
    if (repo) {
      [repository] = await tx
        .insert(projectRepositories)
        .values({
          projectId: project!.id,
          githubRepositoryId: repo.id,
          githubRepositoryName: repo.full_name,
          branch: input.repository!.branch || repo.default_branch,
        })
        .returning();
    }
    if (isImage && input.registry) await saveRegistryCredentials(tx, project!.id, input.registry, input.image ?? null);
    if (input.envVars?.length) {
      await tx.insert(environmentVariables).values(
        input.envVars.map((v) => ({
          projectId: project!.id,
          key: v.key,
          value: encryptSecret(v.value, `${project!.id}:${v.key}`),
          target: v.target,
          scope: v.scope,
          isSecret: v.isSecret,
        })),
      );
    }
    // Same transaction as the insert: the event exists if and only if the project does.
    await emitProjectEvent(tx as unknown as Executor, project!, repository, 'created', { kind: extras?.createdVia === 'connector' ? 'connector' : 'user', userId });
    return { project: project!, repository };
  });

  const deployment = input.deploy
    ? await createDeployment({
        project: created.project,
        repository: created.repository,
        orgPlan: org.plan,
        environment: 'production',
        trigger: extras?.trigger ?? 'manual',
        createdBy: userId,
        // A deployment inherits the correlation ids and provenance of its project.
        metadata: extras?.metadata,
        externalRef: extras?.externalRef,
        createdVia: extras?.createdVia,
      })
    : null;
  return { ...created, deployment };
}

export async function updateProject(options: {
  org: Organization;
  project: Project;
  input: UpdateProjectInput;
  extras?: Pick<CreationExtras, 'metadata' | 'externalRef'>;
  actor?: ActorSpec;
}): Promise<Project> {
  const { org, project, input, extras } = options;
  assertWithinPlan(org, input);
  const { branch, image, registry, ...rest } = input;
  const isImage = project.sourceType === 'image';
  if (!isImage && (image !== undefined || registry !== undefined)) {
    throw badRequest('Only Docker image projects have an image and registry login');
  }
  if (!isImage && input.port === 0) throw badRequest('Port must be between 1 and 65535');

  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  if (image !== undefined) patch.dockerImage = image;
  if (extras?.metadata !== undefined) patch.metadata = extras.metadata;
  if (extras?.externalRef !== undefined) patch.externalRef = extras.externalRef;
  if (project.type === 'cron' && patch.cronSchedule === undefined && !project.cronSchedule) {
    throw badRequest('Cron jobs need a schedule');
  }
  const updated = await withOutbox(db, async (tx) => {
    const [row] = await tx.update(projects).set(patch).where(eq(projects.id, project.id)).returning();
    if (branch) {
      await tx.update(projectRepositories).set({ branch }).where(eq(projectRepositories.projectId, project.id));
    }
    if (registry !== undefined) await saveRegistryCredentials(tx, project.id, registry, row!.dockerImage);
    await emitProjectEventById(tx, project.id, 'updated', options.actor ?? { kind: 'user' });
    return row!;
  });
  return updated;
}

/**
 * Deletes the project row immediately (cascading deployments/domains/env vars) and hands the cleanup of
 * running containers and stored artifacts to the maintenance worker, which no longer needs the rows.
 */
export async function deleteProject(project: Project, actor: ActorSpec = { kind: 'user' }): Promise<void> {
  const projectDeployments = await db.select({ id: deployments.id }).from(deployments).where(eq(deployments.projectId, project.id));
  const deploymentIds = projectDeployments.map((d) => d.id);
  const running = deploymentIds.length
    ? await db
        .select({ nodeId: instances.nodeId, containerId: instances.containerId })
        .from(instances)
        .where(and(eq(instances.projectId, project.id), inArray(instances.status, ['STARTING', 'RUNNING', 'UNHEALTHY'])))
    : [];

  await withOutbox(db, async (tx) => {
    const [repository] = await tx.select().from(projectRepositories).where(eq(projectRepositories.projectId, project.id)).limit(1);
    // The event carries the project's last known state and is written in the same transaction as the delete.
    await emitProjectEvent(tx, project, repository ?? null, 'deleted', actor);
    await tx.delete(projects).where(eq(projects.id, project.id));
  });
  await publishRouteInvalidation(getRedis(), { projectId: project.id });
  await getMaintenanceQueue().add('teardown-project', {
    projectId: project.id,
    deploymentIds,
    instances: running.filter((i) => i.containerId),
  });
}

export function assertProjectType(value: string): asserts value is ProjectType {
  if (!['static', 'web_service', 'worker', 'cron'].includes(value)) {
    throw new ApiError(400, `Unknown project type "${value}"`, 'bad_request');
  }
}
