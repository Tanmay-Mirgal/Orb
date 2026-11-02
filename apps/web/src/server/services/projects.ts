import { randomBytes } from 'node:crypto';
import { encryptSecret, publishRouteInvalidation } from 'core';
import {
  and,
  count,
  deployments,
  environmentVariables,
  eq,
  inArray,
  instances,
  ne,
  projectRepositories,
  projects,
  type Deployment,
  type Organization,
  type Project,
  type ProjectRepository,
} from 'database';
import {
  getInstancePlan,
  getOrgPlan,
  isReservedSlug,
  slugify,
  type CreateProjectInput,
  type UpdateProjectInput,
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
    throw planLimit(`The ${getInstancePlan(input.instancePlan).name} instance size is not available on your ${plan.name} plan`);
  }
  if (input.instanceCount && input.instanceCount > plan.maxInstancesPerService) {
    throw planLimit(`Your ${plan.name} plan allows up to ${plan.maxInstancesPerService} instance(s) per service`);
  }
  if (input.previewDeployments && !plan.previewDeployments) {
    throw planLimit('Preview deployments are not included in your plan');
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

export async function createProject(options: {
  userId: string;
  org: Organization;
  input: CreateProjectInput;
}): Promise<{ project: Project; repository: ProjectRepository; deployment: Deployment | null }> {
  const { userId, org, input } = options;
  const plan = getOrgPlan(org.plan);

  const [existing] = await db.select({ n: count() }).from(projects).where(eq(projects.orgId, org.id));
  if ((existing?.n ?? 0) >= plan.maxProjects) {
    throw planLimit(`Your ${plan.name} plan allows up to ${plan.maxProjects} projects`);
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
      );
    }
  }

  // Trust GitHub, not the browser: confirm the user can read the repository and take canonical identifiers from it.
  const token = await getUserGithubToken(userId);
  const repo = await getRepo(token, input.repository.fullName);

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
        framework: input.framework,
        rootDirectory: input.rootDirectory ?? '',
        installCommand: input.installCommand,
        buildCommand: input.buildCommand,
        startCommand: input.startCommand,
        outputDirectory: input.outputDirectory ?? (type === 'static' ? 'dist' : null),
        dockerfilePath: input.dockerfilePath,
        port: input.port ?? 3000,
        healthCheckPath: input.healthCheckPath ?? '/',
        instancePlan: input.instancePlan ?? 'free',
        instanceCount: input.instanceCount ?? 1,
        cronSchedule: input.cronSchedule,
        autoDeploy: input.autoDeploy ?? true,
        previewDeployments: input.previewDeployments ?? false,
      })
      .returning();
    const [repository] = await tx
      .insert(projectRepositories)
      .values({
        projectId: project!.id,
        githubRepositoryId: repo.id,
        githubRepositoryName: repo.full_name,
        branch: input.repository.branch || repo.default_branch,
      })
      .returning();
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
    return { project: project!, repository: repository! };
  });

  const deployment = input.deploy
    ? await createDeployment({
        project: created.project,
        repository: created.repository,
        orgPlan: org.plan,
        environment: 'production',
        trigger: 'manual',
        createdBy: userId,
      })
    : null;
  return { ...created, deployment };
}

export async function updateProject(options: {
  org: Organization;
  project: Project;
  input: UpdateProjectInput;
}): Promise<Project> {
  const { org, project, input } = options;
  assertWithinPlan(org, input);
  const { branch, ...rest } = input;

  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  if (project.type === 'cron' && patch.cronSchedule === undefined && !project.cronSchedule) {
    throw badRequest('Cron jobs need a schedule');
  }
  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, project.id)).returning();
  if (branch) {
    await db.update(projectRepositories).set({ branch }).where(eq(projectRepositories.projectId, project.id));
  }
  return updated!;
}

/**
 * Deletes the project row immediately (cascading deployments/domains/env vars) and hands the cleanup of
 * running containers and stored artifacts to the maintenance worker, which no longer needs the rows.
 */
export async function deleteProject(project: Project): Promise<void> {
  const projectDeployments = await db.select({ id: deployments.id }).from(deployments).where(eq(deployments.projectId, project.id));
  const deploymentIds = projectDeployments.map((d) => d.id);
  const running = deploymentIds.length
    ? await db
        .select({ nodeId: instances.nodeId, containerId: instances.containerId })
        .from(instances)
        .where(and(eq(instances.projectId, project.id), inArray(instances.status, ['STARTING', 'RUNNING', 'UNHEALTHY'])))
    : [];

  await db.delete(projects).where(eq(projects.id, project.id));
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
