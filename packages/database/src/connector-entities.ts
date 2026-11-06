import { deploymentUrl, platformConfig } from 'core';
import type { DeploymentEntity, ProjectEntity } from 'shared';
import type { Deployment, Project, ProjectRepository } from './schema';

/**
 * Explicit row -> API projections for the ecosystem connector, shared by the web API and the event emitter so a
 * resource and the event about it can never disagree. Nothing is spread from a row: a new column (or a secret such
 * as the image reference or the build configuration) cannot leak by accident.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function projectWebUrl(project: Pick<Project, 'slug'>): string {
  return `${platformConfig().dashboardUrl}/dashboard/projects/${project.slug ?? ''}`;
}

export function deploymentWebUrl(project: Pick<Project, 'slug'>, deploymentId: string): string {
  return `${projectWebUrl(project)}?deployment=${deploymentId}`;
}

export type TriggeredBy = DeploymentEntity['triggeredBy'];

/** `git_push` is called `push` in the connector. */
export function triggeredBy(trigger: string): TriggeredBy {
  if (trigger === 'git_push') return 'push';
  return trigger === 'manual' || trigger === 'api' || trigger === 'redeploy' || trigger === 'rollback' ? trigger : 'manual';
}

export function toProjectEntity(project: Project, repository: ProjectRepository | null): ProjectEntity {
  return {
    id: project.id,
    webUrl: projectWebUrl(project),
    name: project.name,
    slug: project.slug,
    type: project.type as ProjectEntity['type'],
    source: project.sourceType === 'image' ? 'image' : 'git',
    framework: project.framework,
    url: project.slug ? deploymentUrl(project.slug) : null,
    repository: repository ? { fullName: repository.githubRepositoryName, id: repository.githubRepositoryId, branch: repository.branch } : null,
    image: project.dockerImage,
    rootDirectory: project.rootDirectory ?? '',
    installCommand: project.installCommand,
    buildCommand: project.buildCommand,
    startCommand: project.startCommand,
    outputDirectory: project.outputDirectory,
    port: project.port,
    healthCheckPath: project.healthCheckPath,
    instancePlan: project.instancePlan,
    instanceCount: project.instanceCount,
    cronSchedule: project.cronSchedule,
    autoDeploy: project.autoDeploy,
    previewDeployments: project.previewDeployments,
    currentDeploymentId: project.currentDeploymentId,
    sleeping: project.sleepingAt !== null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    metadata: project.metadata ?? null,
    externalRef: project.externalRef ?? null,
    createdVia: project.createdVia,
  };
}

export function toDeploymentEntity(deployment: Deployment, project: Pick<Project, 'slug' | 'currentDeploymentId'>): DeploymentEntity {
  const started = deployment.buildStartedAt;
  const finished = deployment.buildFinishedAt;
  return {
    id: deployment.id,
    webUrl: deploymentWebUrl(project, deployment.id),
    projectId: deployment.projectId,
    status: deployment.status as DeploymentEntity['status'],
    environment: deployment.environment === 'preview' ? 'preview' : 'production',
    branch: deployment.branch,
    commitSha: deployment.commitHash,
    commitMessage: deployment.commitMessage,
    commitAuthor: deployment.commitAuthor,
    triggeredBy: triggeredBy(deployment.trigger),
    url: deployment.subdomain ? deploymentUrl(deployment.subdomain) : null,
    isCurrent: project.currentDeploymentId === deployment.id,
    buildDurationMs: started && finished ? Math.max(0, finished.getTime() - started.getTime()) : null,
    errorMessage: deployment.errorMessage,
    createdAt: deployment.createdAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
    startedAt: iso(started),
    finishedAt: iso(finished),
    readyAt: iso(deployment.readyAt),
    metadata: deployment.metadata ?? null,
    externalRef: deployment.externalRef ?? null,
    createdVia: deployment.createdVia,
  };
}
