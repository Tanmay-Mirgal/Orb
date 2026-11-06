import { and, deployments, environmentVariables, eq, projectRepositories, toDeploymentEntity, toProjectEntity, type Deployment, type Project } from 'database';
import { env, getRepositoryInstallationId } from 'core';
import {
  createProjectSchema,
  cpValidation,
  detectProject,
  envVarInputSchema,
  normalizeRelativeDir,
  parseDotenv,
  updateProjectSchema,
  type ActionInput,
  type ActionName,
  type ActionOutput,
  type EnvVarInput,
} from 'shared';
import { db } from '@/lib/db';
import { createGithubProbe, getRepo, getUserGithubToken } from '../github';
import { addDomain, removeDomain, verifyDomain } from '../services/domains';
import { cancelDeployment, createDeployment, promoteDeployment } from '../services/deployments';
import { deleteEnvVar, upsertEnvVars } from '../services/env';
import { createProject, updateProject, type CreationExtras } from '../services/projects';
import { auditConnectorCall } from './audit';
import { requirePermission, requireScope, type ConnectorAuth } from './auth';
import { pinnedDeployment, pinnedProject } from './data';
import { toDomainEntity } from './entities';
import { githubAppInstallUrl } from './usage';

export interface ActionContext {
  auth: ConnectorAuth;
  requestId: string;
}

export type SyncActionName = Exclude<ActionName, 'projects.waitForDeployment'>;
type Handler<N extends SyncActionName> = (ctx: ActionContext, input: ActionInput<N>) => Promise<ActionOutput<N>>;

const CONNECTED = 'connector' as const;

/** Provenance and correlation ids stored on what the connector creates; its deployments are recorded as `api`. */
const extrasOf = (input: { metadata?: Record<string, unknown>; externalRef?: CreationExtras['externalRef'] }): CreationExtras => ({
  metadata: input.metadata,
  externalRef: input.externalRef,
  createdVia: CONNECTED,
  trigger: 'api',
});

interface Warning {
  code: string;
  message: string;
  fixUrl?: string;
}

/** Whether pushes reach Orb: they only do for repositories the Orb GitHub App is installed on. */
async function pushToDeployStatus(fullName: string): Promise<{ installed: boolean; warning?: Warning }> {
  const appId = env('GITHUB_APP_ID');
  const key = env('GITHUB_APP_PRIVATE_KEY');
  if (!appId || !key) {
    return { installed: false, warning: { code: 'github_app_not_configured', message: 'This Orb has no GitHub App configured, so pushes do not deploy automatically. Trigger deployments with deployments.trigger.' } };
  }
  try {
    const installation = await getRepositoryInstallationId(appId, key, fullName);
    if (installation !== null) return { installed: true };
  } catch {
    return { installed: false, warning: { code: 'github_app_unreachable', message: 'Could not check whether the Orb GitHub App is installed on this repository. Try again later.' } };
  }
  return {
    installed: false,
    warning: {
      code: 'github_app_not_installed',
      message: 'Install the Orb GitHub App on this repository so every push deploys automatically.',
      ...(githubAppInstallUrl() ? { fixUrl: githubAppInstallUrl()! } : {}),
    },
  };
}

async function repositoryOf(projectId: string) {
  const [repository] = await db.select().from(projectRepositories).where(eq(projectRepositories.projectId, projectId)).limit(1);
  return repository ?? null;
}

const deploymentOutput = (deployment: Deployment, project: Pick<Project, 'slug' | 'currentDeploymentId'>) => ({ deployment: toDeploymentEntity(deployment, project) });

const detectFramework: Handler<'projects.detectFramework'> = async ({ auth }, input) => {
  const rootDir = normalizeRelativeDir(input.rootDirectory);
  if (rootDir === null) throw cpValidation('Invalid root directory', [{ path: 'rootDirectory', message: 'must be a relative path inside the repository' }]);
  const token = await getUserGithubToken(auth.userId);
  const repo = await getRepo(token, input.repository.fullName);
  const detection = await detectProject(createGithubProbe(token, repo.full_name, input.repository.branch), rootDir);
  return {
    detection: detection as unknown as Record<string, unknown>,
    suggestedType: detection.suggestedType,
    hasDetectableFramework: detection.framework !== 'unknown',
  };
};

const projectsCreate: Handler<'projects.create'> = async (ctx, input) => {
  const { auth } = ctx;
  requirePermission(auth, 'project:create');
  let deploy = input.deploy;
  if (deploy) {
    requireScope(auth, 'orb:deployments:write');
    requirePermission(auth, 'deployment:create');
  }
  const warnings: Warning[] = [];
  const isImage = input.source === 'image';

  let fullName: string | null = null;
  let branch: string | null = null;
  if (!isImage) {
    // Creating a Git project needs the connecting user's own GitHub link (412 + fixUrl when missing).
    const token = await getUserGithubToken(auth.userId);
    const repo = await getRepo(token, input.repository!.fullName);
    fullName = repo.full_name;
    branch = input.repository!.branch ?? repo.default_branch;
    const configured = Boolean(input.framework || input.buildCommand || input.startCommand || input.dockerfilePath);
    if (deploy && !configured) {
      const detection = await detectProject(createGithubProbe(token, repo.full_name, branch), normalizeRelativeDir(input.rootDirectory) ?? '').catch(() => null);
      if (!detection || detection.framework === 'unknown') {
        deploy = false;
        warnings.push({
          code: 'no_detectable_framework',
          message: 'No framework could be detected (the repository may be empty), so the project was created without a first deployment. The first push builds it.',
        });
      }
    }
  }

  const parsed = createProjectSchema.parse({
    name: input.name,
    type: input.type,
    source: input.source,
    repository: isImage ? undefined : { fullName: fullName!, id: input.repository!.id ?? 0, branch },
    image: input.image,
    registry: input.registry,
    framework: input.framework,
    rootDirectory: input.rootDirectory,
    installCommand: input.installCommand,
    buildCommand: input.buildCommand,
    startCommand: input.startCommand,
    outputDirectory: input.outputDirectory,
    dockerfilePath: input.dockerfilePath,
    port: input.port,
    healthCheckPath: input.healthCheckPath,
    instancePlan: input.instancePlan,
    instanceCount: input.instanceCount,
    cronSchedule: input.cronSchedule,
    autoDeploy: input.autoDeploy,
    previewDeployments: input.previewDeployments,
    envVars: input.envVars?.map((v) => ({ key: v.key, value: v.value, scope: v.scope, target: v.target, isSecret: v.sensitive })),
    deploy,
  });
  const { project, repository, deployment } = await createProject({ userId: auth.userId, org: auth.org, input: parsed, extras: extrasOf(input) });

  await auditConnectorCall(auth, 'projects.create', { orgId: auth.org.id, action: 'project.create', targetType: 'project', targetId: project.id, metadata: { name: project.name, type: project.type } });
  if (deployment) {
    await auditConnectorCall(auth, 'projects.create', { orgId: auth.org.id, action: 'deployment.create', targetType: 'deployment', targetId: deployment.id, metadata: { trigger: 'api' } });
  }

  let pushActive = false;
  if (fullName) {
    const status = await pushToDeployStatus(fullName);
    pushActive = status.installed && project.autoDeploy;
    if (status.warning) warnings.push(status.warning);
  }
  return {
    project: toProjectEntity(project, repository),
    repository: repository ? { fullName: repository.githubRepositoryName, id: repository.githubRepositoryId, branch: repository.branch } : null,
    deployment: deployment ? toDeploymentEntity(deployment, project) : null,
    autoDeploy: pushActive,
    warnings,
    ...(repository
      ? {
          pushToDeployHint: {
            remote: `https://github.com/${repository.githubRepositoryName}.git`,
            branch: repository.branch,
            message: pushActive ? `Push to ${repository.branch} to deploy.` : warnings.some((w) => w.code === 'github_app_not_installed') ? 'Install the Orb GitHub App on the repository first, then push to deploy.' : `Pushes do not deploy automatically; use deployments.trigger.`,
          },
        }
      : {}),
  };
};

const projectsUpdate: Handler<'projects.update'> = async ({ auth }, input) => {
  const { project } = await pinnedProject(auth, input.projectId);
  const { projectId, metadata, externalRef, ...rest } = input;
  void projectId;
  const parsed = updateProjectSchema.parse(rest);
  const updated = await updateProject({ org: auth.org, project, input: parsed, extras: { metadata, externalRef } });
  await auditConnectorCall(auth, 'projects.update', { orgId: auth.org.id, action: 'project.update', targetType: 'project', targetId: project.id, metadata: { fields: Object.keys(rest) } });
  return { project: toProjectEntity(updated, await repositoryOf(project.id)) };
};

const deploymentsTrigger: Handler<'deployments.trigger'> = async ({ auth }, input) => {
  const { project, repository } = await pinnedProject(auth, input.projectId);
  const extras = { metadata: input.metadata, externalRef: input.externalRef, createdVia: CONNECTED, createdBy: auth.userId, trigger: 'api' as const };
  let deployment: Deployment;
  if (project.sourceType === 'image') {
    // "Deploy" pulls the configured image again (picks up a moved tag such as `latest`).
    if (input.environment === 'preview') throw cpValidation('Preview deployments need a Git repository', [{ path: 'environment', message: 'Docker image projects have no previews' }]);
    deployment = await createDeployment({ project, repository: null, orgPlan: auth.org.plan, environment: 'production', ...extras });
  } else {
    if (!repository) throw cpValidation('Project has no connected repository');
    const branch = input.branch ?? repository.branch;
    const environment = input.environment ?? (branch !== repository.branch ? 'preview' : 'production');
    deployment = await createDeployment({ project, repository, orgPlan: auth.org.plan, environment, branch, commitSha: input.commitSha ?? null, ...extras });
  }
  await auditConnectorCall(auth, 'deployments.trigger', { orgId: auth.org.id, action: 'deployment.create', targetType: 'deployment', targetId: deployment.id, metadata: { branch: deployment.branch, environment: deployment.environment } });
  return deploymentOutput(deployment, project);
};

const deploymentsCancel: Handler<'deployments.cancel'> = async ({ auth }, input) => {
  const { deployment, project } = await pinnedDeployment(auth, input.deploymentId);
  const canceled = await cancelDeployment(deployment);
  await auditConnectorCall(auth, 'deployments.cancel', { orgId: auth.org.id, action: 'deployment.cancel', targetType: 'deployment', targetId: deployment.id });
  return deploymentOutput(canceled, project);
};

const deploymentsRedeploy: Handler<'deployments.redeploy'> = async ({ auth }, input) => {
  const { deployment, project, repository } = await pinnedDeployment(auth, input.deploymentId);
  if (!repository && project.sourceType !== 'image') throw cpValidation('Project has no connected repository');
  const created = await createDeployment({
    project,
    repository,
    orgPlan: auth.org.plan,
    environment: deployment.environment === 'preview' ? 'preview' : 'production',
    trigger: 'redeploy',
    branch: deployment.branch ?? repository?.branch,
    commitSha: deployment.commitHash,
    commitMessage: deployment.commitMessage,
    commitAuthor: deployment.commitAuthor,
    config: deployment.config ?? undefined,
    createdBy: auth.userId,
    metadata: input.metadata,
    externalRef: input.externalRef,
    createdVia: CONNECTED,
  });
  await auditConnectorCall(auth, 'deployments.redeploy', { orgId: auth.org.id, action: 'deployment.redeploy', targetType: 'deployment', targetId: created.id, metadata: { from: deployment.id } });
  return deploymentOutput(created, project);
};

const deploymentsPromote: Handler<'deployments.promote'> = async ({ auth }, input) => {
  // Same rule as the dashboard: promoting (and rolling back) takes the admin role.
  requirePermission(auth, 'deployment:promote');
  const { deployment, project } = await pinnedDeployment(auth, input.deploymentId);
  const isRollback = project.currentDeploymentId !== null && project.currentDeploymentId !== deployment.id;
  const result = await promoteDeployment(project, deployment);
  await auditConnectorCall(auth, 'deployments.promote', {
    orgId: auth.org.id,
    action: isRollback ? 'deployment.rollback' : 'deployment.promote',
    targetType: 'deployment',
    targetId: deployment.id,
    metadata: { previous: project.currentDeploymentId },
  });
  const [fresh] = await db.select().from(deployments).where(eq(deployments.id, deployment.id)).limit(1);
  const { project: liveProject } = await pinnedProject(auth, project.id);
  return { ...deploymentOutput(fresh ?? deployment, liveProject), queued: result.queued };
};

const envSet: Handler<'env.set'> = async ({ auth }, input) => {
  const { project } = await pinnedProject(auth, input.projectId);
  let vars: EnvVarInput[];
  let skipped: string[] | undefined;
  if ('dotenv' in input) {
    const parsed = parseDotenv(input.dotenv);
    skipped = parsed.skipped;
    vars = parsed.vars.map((v) => envVarInputSchema.parse(v));
  } else {
    vars = input.vars.map((v) => ({ key: v.key, value: v.value, scope: v.scope, target: v.target, isSecret: v.sensitive }));
  }
  if (vars.length === 0) throw cpValidation('No environment variables found in the request');
  const saved = await upsertEnvVars(project.id, vars);
  const keys = saved.map((s) => ({ key: s.key, target: s.target, scope: s.scope, sensitive: s.isSecret }));
  // The audit trail records which keys changed, never their values.
  await auditConnectorCall(auth, 'env.set', { orgId: auth.org.id, action: 'env.set', targetType: 'project', targetId: project.id, metadata: { keys: keys.map((k) => k.key) } });
  return { projectId: project.id, count: keys.length, keys, ...(skipped && skipped.length > 0 ? { skipped } : {}) };
};

const envRemove: Handler<'env.remove'> = async ({ auth }, input) => {
  const { project } = await pinnedProject(auth, input.projectId);
  const [row] = await db
    .select({ id: environmentVariables.id })
    .from(environmentVariables)
    .where(and(eq(environmentVariables.projectId, project.id), eq(environmentVariables.key, input.key), eq(environmentVariables.target, input.target)))
    .limit(1);
  if (row) {
    await deleteEnvVar(project.id, row.id);
    await auditConnectorCall(auth, 'env.remove', { orgId: auth.org.id, action: 'env.delete', targetType: 'project', targetId: project.id, metadata: { key: input.key } });
  }
  return { projectId: project.id, key: input.key, target: input.target, removed: Boolean(row) };
};

const domainsAdd: Handler<'domains.add'> = async ({ auth }, input) => {
  const { project } = await pinnedProject(auth, input.projectId);
  const view = await addDomain({ projectId: project.id, orgPlan: auth.org.plan, rawDomain: input.domain, redirectTo: input.redirectTo });
  await auditConnectorCall(auth, 'domains.add', { orgId: auth.org.id, action: 'domain.add', targetType: 'domain', targetId: view.domain });
  return { domain: toDomainEntity(view, project) };
};

const domainsVerify: Handler<'domains.verify'> = async ({ auth }, input) => {
  const { project } = await pinnedProject(auth, input.projectId);
  const result = await verifyDomain(project.id, input.domain);
  await auditConnectorCall(auth, 'domains.verify', { orgId: auth.org.id, action: 'domain.verify', targetType: 'domain', targetId: result.domain.domain });
  return { domain: toDomainEntity(result.domain, project), ownership: result.ownership, routing: result.routing };
};

const domainsRemove: Handler<'domains.remove'> = async ({ auth }, input) => {
  const { project } = await pinnedProject(auth, input.projectId);
  await removeDomain(project.id, input.domain);
  await auditConnectorCall(auth, 'domains.remove', { orgId: auth.org.id, action: 'domain.remove', targetType: 'domain', targetId: input.domain });
  return { domain: input.domain.toLowerCase(), removed: true };
};

export const HANDLERS: { [N in SyncActionName]: Handler<N> } = {
  'projects.detectFramework': detectFramework,
  'projects.create': projectsCreate,
  'projects.update': projectsUpdate,
  'deployments.trigger': deploymentsTrigger,
  'deployments.cancel': deploymentsCancel,
  'deployments.redeploy': deploymentsRedeploy,
  'deployments.promote': deploymentsPromote,
  'env.set': envSet,
  'env.remove': envRemove,
  'domains.add': domainsAdd,
  'domains.verify': domainsVerify,
  'domains.remove': domainsRemove,
};

/** Starts a long-running action: validates what it refers to and says until when to wait. */
export async function startWaitForDeployment(ctx: ActionContext, input: ActionInput<'projects.waitForDeployment'>): Promise<{ input: Record<string, unknown>; deadlineAt: Date }> {
  await pinnedDeployment(ctx.auth, input.deploymentId); // 404 for a deployment of another team
  return { input: { deploymentId: input.deploymentId, timeoutSeconds: input.timeoutSeconds }, deadlineAt: new Date(Date.now() + input.timeoutSeconds * 1000) };
}
