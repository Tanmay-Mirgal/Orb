import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DelayedError, type Job } from 'bullmq';
import {
  connectorEnabled,
  deploymentUrl,
  enqueueRelease,
  getInstallationToken,
  publishRouteInvalidation,
  type Logger,
} from 'core';
import {
  and,
  count,
  deployments,
  emitDeploymentEvent,
  eq,
  inArray,
  organizations,
  projectRepositories,
  projects,
  accounts,
  resolveEnvVars,
  withOutbox,
  type Database,
  type Deployment,
  type Project,
  type ProjectRepository,
  type Organization,
} from 'database';
import {
  DeploymentStatus,
  detectProject,
  getOrgPlan,
  normalizeRelativeDir,
  toShellEnvFile,
  type BuildJob,
  type Detection,
  type DeploymentConfig,
  type FileProbe,
  type ProjectType,
} from 'shared';
import { storageKeys } from 'storage';
import type { WorkerContext } from '../context';
import { notifyDeployment } from '../notifications';
import { BuildLog } from './buildlog';
import {
  DOCKERIGNORE,
  goServiceBuild,
  nodeServiceBuild,
  nodeStaticBuild,
  pythonServiceBuild,
  type GeneratedBuild,
} from './dockerfiles';
import { cloneRepository } from './git';
import { loadRegistryLogin, pullImage, resolveImagePort } from './image';
import { runCommand } from './process';
import { loadOrbConfig, publishStaticSite } from './publish';

class CanceledError extends Error {
  constructor() {
    super('Build canceled');
  }
}

function fsProbe(root: string): FileProbe {
  const resolve = (p: string) => path.join(root, p);
  return {
    exists: async (p) => fs.existsSync(resolve(p)),
    read: async (p) => {
      try {
        return fs.readFileSync(resolve(p), 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}

interface Loaded {
  deployment: Deployment;
  project: Project;
  /** Absent for Docker image projects. */
  repository: ProjectRepository | null;
  org: Organization;
}

async function load(db: Database, deploymentId: string): Promise<Loaded | null> {
  const [row] = await db
    .select({ deployment: deployments, project: projects, repository: projectRepositories, org: organizations })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  return row ?? null;
}

/** Installation token (private repos via the GitHub App) -> owner's OAuth token -> anonymous (public repos). */
async function resolveGitToken(ctx: WorkerContext, project: Project, repository: ProjectRepository): Promise<string | undefined> {
  const appId = process.env.GITHUB_APP_ID;
  const key = process.env.GITHUB_APP_PRIVATE_KEY;
  if (repository.installationId && appId && key) {
    try {
      return await getInstallationToken(appId, key, repository.installationId);
    } catch (err) {
      ctx.logger.warn({ err: String(err) }, 'installation token failed; falling back to OAuth token');
    }
  }
  const [account] = await ctx.db
    .select({ accessToken: accounts.accessToken })
    .from(accounts)
    .where(and(eq(accounts.userId, project.userId), eq(accounts.providerId, 'github')))
    .limit(1);
  return account?.accessToken ?? undefined;
}

function snapshotFromProject(project: Project): DeploymentConfig {
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

/** Explicit project settings win; blanks are filled from auto-detection. */
function effective(config: DeploymentConfig, detection: Detection) {
  const pick = (value: string | null | undefined, fallback: string) => (value && value.trim() ? value.trim() : fallback);
  return {
    installCommand: pick(config.installCommand, detection.installCommand),
    buildCommand: config.buildCommand === undefined || config.buildCommand === null ? detection.buildCommand : config.buildCommand.trim(),
    startCommand: pick(config.startCommand, detection.startCommand),
    outputDirectory: pick(config.outputDirectory, detection.outputDirectory),
    port: config.port || detection.port,
  };
}

function writeBuildFiles(workspace: string, generated: GeneratedBuild) {
  const dir = path.join(workspace, '.orb-build');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dockerfile'), generated.dockerfile);
  for (const [name, content] of Object.entries(generated.files)) {
    fs.writeFileSync(path.join(dir, name), content, { mode: 0o755 });
  }
  const ignore = path.join(workspace, '.dockerignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, DOCKERIGNORE);
}

function imageTag(registry: string, projectId: string, deploymentId: string): string {
  const repo = `${projectId}`.toLowerCase();
  return registry ? `${registry}/${repo}:${deploymentId}` : `orb/${repo}:${deploymentId}`;
}

/**
 * The build pipeline: clone -> detect -> docker build -> publish (static) / push image (services) -> release.
 * Everything here is cancelable, time-boxed, and never logs secret values.
 */
export async function runBuildJob(ctx: WorkerContext, job: Job<BuildJob>, token?: string): Promise<void> {
  const { db } = ctx;
  const loaded = await load(db, job.data.deploymentId);
  if (!loaded) return; // project deleted while queued
  const { deployment, project, repository, org } = loaded;
  if (deployment.status !== DeploymentStatus.QUEUED && deployment.status !== DeploymentStatus.BUILDING) return;

  // Fair scheduling: a tenant at its concurrent-build limit waits instead of starving the others.
  const plan = getOrgPlan(org.plan);
  const [running] = await db
    .select({ n: count() })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(and(eq(projects.orgId, org.id), eq(deployments.status, DeploymentStatus.BUILDING)));
  if ((running?.n ?? 0) >= plan.maxConcurrentBuilds && deployment.status === DeploymentStatus.QUEUED && token) {
    await job.moveToDelayed(Date.now() + 5000, token);
    throw new DelayedError();
  }

  const claimed = await withOutbox(db, async (tx) => {
    const rows = await tx
      .update(deployments)
      .set({ status: DeploymentStatus.BUILDING, buildStartedAt: new Date(), updatedAt: new Date(), errorMessage: null })
      .where(and(eq(deployments.id, deployment.id), inArray(deployments.status, [DeploymentStatus.QUEUED, DeploymentStatus.BUILDING])))
      .returning({ id: deployments.id });
    // Only the QUEUED -> BUILDING transition is an event; picking a build up again after a restart is not.
    if (rows.length > 0 && deployment.status === DeploymentStatus.QUEUED) await emitDeploymentEvent(tx, deployment.id, 'building');
    return rows;
  });
  if (claimed.length === 0) return;

  const log = new BuildLog(ctx.logs, deployment.id);
  const abort = new AbortController();
  const cancelWatcher = setInterval(async () => {
    const [row] = await db.select({ status: deployments.status }).from(deployments).where(eq(deployments.id, deployment.id));
    if (row?.status === DeploymentStatus.CANCELED) abort.abort();
  }, 3000);
  const workspace = path.join(ctx.config.workDir, deployment.id);
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-secret-'));

  try {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.mkdirSync(workspace, { recursive: true });
    log.line(`[orb] Deployment ${deployment.id.slice(0, 8)} for ${project.name} (${deployment.environment})`);

    const config = deployment.config ?? snapshotFromProject(project);
    const environment = deployment.environment === 'preview' ? 'preview' : 'production';

    // Docker image projects skip clone/detect/build: the image is pulled and handed straight to the scheduler.
    if (config.source === 'image') {
      await deployImage({ ctx, deployment, project, config, environment, log, signal: abort.signal, timeoutMs: plan.buildTimeoutSec * 1000, scratchDir: secretDir });
      return;
    }
    if (!repository) throw new Error('Project has no connected repository');

    // 1. Source ----------------------------------------------------------------------------------------------
    const gitToken = await resolveGitToken(ctx, project, repository);
    log.line(`[git] Cloning ${repository.githubRepositoryName}@${deployment.branch ?? repository.branch}${gitToken ? '' : ' (anonymous)'}`);
    const commit = await cloneRepository({
      repo: repository.githubRepositoryName,
      branch: deployment.branch ?? repository.branch,
      sha: deployment.commitHash,
      dest: workspace,
      token: gitToken,
      onLine: log.line,
      signal: abort.signal,
    });
    await db
      .update(deployments)
      .set({
        commitHash: commit.sha,
        commitAuthor: deployment.commitAuthor ?? commit.author,
        commitMessage: deployment.commitMessage ?? commit.message,
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, deployment.id));

    // 2. Configuration ---------------------------------------------------------------------------------------
    const rootDirectory = normalizeRelativeDir(config.rootDirectory);
    if (rootDirectory === null) throw new Error('Invalid root directory');
    if (!fs.existsSync(path.join(workspace, rootDirectory))) {
      throw new Error(`Root directory "${rootDirectory}" does not exist in the repository`);
    }
    const detection = await detectProject(fsProbe(workspace), rootDirectory);
    for (const note of detection.notes) log.line(`[detect] ${note}`);
    log.line(`[detect] ${detection.frameworkName} (${detection.runtime})`);
    const eff = effective(config, detection);

    const buildEnv = await resolveEnvVars(db, project.id, { environment, scope: 'build' });
    const runtimeEnv = await resolveEnvVars(db, project.id, { environment, scope: 'runtime' });
    log.setSecrets([...buildEnv.secretValues, ...runtimeEnv.secretValues]);
    log.line(`[env] ${Object.keys(buildEnv.vars).length} build-time variable(s) available`);

    const timeoutMs = plan.buildTimeoutSec * 1000;
    const envFile = path.join(secretDir, 'orb-env');
    fs.writeFileSync(envFile, toShellEnvFile({ ...buildEnv.vars, ORB: '1', ORB_ENVIRONMENT: environment }), { mode: 0o600 });
    const dockerEnv: NodeJS.ProcessEnv = { ...process.env, DOCKER_BUILDKIT: '1', ...buildEnv.vars };
    const type = config.type;

    // 3. Build -----------------------------------------------------------------------------------------------
    if (type === 'static') {
      const orbConfig = loadOrbConfig(path.join(workspace, rootDirectory));
      let publishDir: string;
      const hasBuild = Boolean(eff.buildCommand) && detection.runtime === 'node';
      if (!hasBuild) {
        publishDir = path.join(workspace, rootDirectory, eff.outputDirectory === '.' ? '' : eff.outputDirectory);
        log.line('[build] No build step: publishing files as they are');
      } else {
        const hasLockHere = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].some((f) => fs.existsSync(path.join(workspace, rootDirectory, f)));
        const generated = nodeStaticBuild({
          nodeMajor: detection.nodeMajor ?? 22,
          packageManager: detection.packageManager ?? 'npm',
          rootDirectory,
          installDirectory: hasLockHere ? rootDirectory : '',
          installCommand: eff.installCommand,
          buildCommand: eff.buildCommand,
          startCommand: '',
          outputDirectory: eff.outputDirectory,
          port: 0,
        });
        writeBuildFiles(workspace, generated);
        const outDir = path.join(secretDir, 'out');
        log.line('[docker] Building static site in an isolated container…');
        const code = await runCommand(
          'docker',
          ['build', '--progress=plain', '--target', 'export', '--output', `type=local,dest=${outDir}`, '--secret', `id=orb_env,src=${envFile}`, '-f', path.join(workspace, '.orb-build', 'Dockerfile'), workspace],
          { env: dockerEnv, onLine: log.line, signal: abort.signal, timeoutMs },
        );
        assertBuildExit(code, abort.signal, timeoutMs);
        publishDir = outDir;
      }

      log.line('[publish] Uploading files to object storage…');
      const result = await publishStaticSite({ storage: ctx.storage, deploymentId: deployment.id, dir: publishDir, config: orbConfig, limits: ctx.config, signal: abort.signal });
      log.line(`[publish] ${result.fileCount} file(s), ${(result.totalBytes / 1024 / 1024).toFixed(1)} MB`);
      await markReady(ctx, deployment, project, { fileCount: result.fileCount });
      await notifyDeployment(ctx, deployment.id, 'ready');
      log.line(`[orb] ✓ Ready at ${deployment.subdomain ? deploymentUrl(deployment.subdomain) : deploymentUrl(project.slug ?? '')}`);
    } else {
      const tag = imageTag(ctx.config.registry, project.id, deployment.id);
      const userDockerfile = config.dockerfilePath
        ? path.join(rootDirectory, config.dockerfilePath)
        : detection.framework === 'dockerfile'
          ? path.join(rootDirectory, 'Dockerfile')
          : null;
      const args = ['build', '--progress=plain', '-t', tag, '--label', `orb.deployment=${deployment.id}`, '--secret', `id=orb_env,src=${envFile}`];
      let contextDir = workspace;
      if (userDockerfile) {
        if (!fs.existsSync(path.join(workspace, userDockerfile))) throw new Error(`Dockerfile not found at ${userDockerfile}`);
        log.line(`[docker] Using your Dockerfile (${userDockerfile})`);
        contextDir = path.join(workspace, rootDirectory);
        args.push('-f', path.join(workspace, userDockerfile));
        for (const key of Object.keys(buildEnv.vars)) args.push('--build-arg', key); // value is taken from the process env
      } else {
        const generated = generateForRuntime(detection, workspace, rootDirectory, eff);
        writeBuildFiles(workspace, generated);
        log.line(`[docker] Generated Dockerfile for ${detection.frameworkName}`);
        args.push('-f', path.join(workspace, '.orb-build', 'Dockerfile'));
      }
      args.push(contextDir);
      const code = await runCommand('docker', args, { env: dockerEnv, onLine: log.line, signal: abort.signal, timeoutMs });
      assertBuildExit(code, abort.signal, timeoutMs);

      if (ctx.config.registry) {
        log.line(`[docker] Pushing ${tag}…`);
        const pushCode = await runCommand('docker', ['push', tag], { onLine: log.line, signal: abort.signal, timeoutMs: 15 * 60_000 });
        assertBuildExit(pushCode, abort.signal, 15 * 60_000);
      }

      const updated = await withOutbox(db, async (tx) => {
        const [row] = await tx
          .update(deployments)
          .set({ status: DeploymentStatus.DEPLOYING, imageRef: tag, buildFinishedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(deployments.id, deployment.id), eq(deployments.status, DeploymentStatus.BUILDING)))
          .returning({ id: deployments.id });
        if (row) await emitDeploymentEvent(tx, deployment.id, 'deploying');
        return row;
      });
      if (!updated) throw new CanceledError();
      if (type === 'cron' || type === 'web_service' || type === 'worker') {
        await enqueueRelease(ctx.releaseQueue, deployment.id, environment === 'production');
      }
      log.line('[orb] Image built. Handing over to the scheduler…');
    }
  } catch (err) {
    const canceled = err instanceof CanceledError || abort.signal.aborted;
    const message = canceled ? 'Build canceled' : err instanceof Error ? err.message : String(err);
    log.line(`[error] ${message}`);
    if (!canceled) ctx.logger.warn({ deploymentId: deployment.id, err: message }, 'build failed');
    await withOutbox(db, async (tx) => {
      const rows = await tx
        .update(deployments)
        .set({
          status: canceled ? DeploymentStatus.CANCELED : DeploymentStatus.FAILED,
          errorMessage: message.slice(0, 2000),
          buildFinishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(deployments.id, deployment.id), inArray(deployments.status, [DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING, DeploymentStatus.QUEUED])))
        .returning({ id: deployments.id });
      // A cancel requested through the API already wrote (and announced) CANCELED: announce only what this statement changed.
      if (rows.length > 0) await emitDeploymentEvent(tx, deployment.id, canceled ? 'canceled' : 'failed');
    });
    if (!canceled) await notifyDeployment(ctx, deployment.id, 'failed');
  } finally {
    clearInterval(cancelWatcher);
    await log.flush();
    await ctx.storage.put(storageKeys.buildLog(deployment.id), log.text(), { contentType: 'text/plain; charset=utf-8' }).catch(() => undefined);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(secretDir, { recursive: true, force: true });
  }
}

/**
 * Deployment of a prebuilt Docker image: pull it (checking size and architecture), keep it under an Orb tag,
 * push it to the platform registry when there is one, then queue the release. Runtime variables are applied by the
 * runner when the container starts, so there is nothing to bake in and no build step.
 */
async function deployImage(args: {
  ctx: WorkerContext;
  deployment: Deployment;
  project: Project;
  config: DeploymentConfig;
  environment: 'production' | 'preview';
  log: BuildLog;
  signal: AbortSignal;
  timeoutMs: number;
  scratchDir: string;
}): Promise<void> {
  const { ctx, deployment, project, config, environment, log, signal, timeoutMs } = args;
  if (config.type === 'static') throw new Error('Static sites cannot be deployed from a Docker image');
  if (!config.image) throw new Error('Project has no Docker image configured');

  const runtimeEnv = await resolveEnvVars(ctx.db, project.id, { environment, scope: 'runtime' });
  const login = await loadRegistryLogin(ctx.db, project.id, config.image, log.line);
  log.setSecrets([...runtimeEnv.secretValues, ...(login ? [login.password] : [])]);
  log.line(`[docker] Pulling ${config.image}${login ? ` (as ${login.username})` : ''}`);

  const tag = imageTag(ctx.config.registry, project.id, deployment.id);
  const pulled = await pullImage({
    image: config.image,
    login,
    tag,
    platformRegistry: ctx.config.registry,
    maxBytes: ctx.config.maxImageBytes,
    timeoutMs,
    scratchDir: args.scratchDir,
    onLine: log.line,
    signal,
  });
  log.line(`[docker] Pulled ${config.image} (${(pulled.sizeBytes / 1024 / 1024).toFixed(0)} MB${pulled.digest ? `, sha256:${pulled.digest.slice(0, 12)}` : ''})`);
  log.line(`[env] ${Object.keys(runtimeEnv.vars).length} runtime variable(s) will be passed to the container`);

  let port = config.port;
  if (config.type === 'web_service') {
    const resolved = resolveImagePort(config.port, pulled.exposedPorts);
    port = resolved.port;
    log.line(`[detect] ${resolved.note}`);
  }

  if (ctx.config.registry) {
    log.line(`[docker] Pushing ${tag}…`);
    const pushCode = await runCommand('docker', ['push', tag], { onLine: log.line, signal, timeoutMs: 15 * 60_000 });
    assertBuildExit(pushCode, signal, 15 * 60_000);
  }

  const updated = await withOutbox(ctx.db, async (tx) => {
    const [row] = await tx
      .update(deployments)
      .set({
        status: DeploymentStatus.DEPLOYING,
        imageRef: tag,
        commitHash: pulled.digest,
        // The snapshot keeps the port that was resolved, so rollbacks and rescheduling use the same one.
        config: { ...config, port },
        buildFinishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(deployments.id, deployment.id), eq(deployments.status, DeploymentStatus.BUILDING)))
      .returning({ id: deployments.id });
    if (row) await emitDeploymentEvent(tx, deployment.id, 'deploying');
    return row;
  });
  if (!updated) throw new CanceledError();
  await enqueueRelease(ctx.releaseQueue, deployment.id, environment === 'production');
  log.line('[orb] Image ready. Handing over to the scheduler…');
}

function assertBuildExit(code: number, signal: AbortSignal, timeoutMs: number) {
  if (signal.aborted) throw new CanceledError();
  if (code === 124) throw new Error(`Build timed out after ${Math.round(timeoutMs / 60000)} minutes`);
  if (code !== 0) throw new Error(`Build failed with exit code ${code}`);
}

function generateForRuntime(
  detection: Detection,
  workspace: string,
  rootDirectory: string,
  eff: ReturnType<typeof effective>,
): GeneratedBuild {
  if (detection.runtime === 'node') {
    const lockHere = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].some((f) => fs.existsSync(path.join(workspace, rootDirectory, f)));
    return nodeServiceBuild({
      nodeMajor: detection.nodeMajor ?? 22,
      packageManager: detection.packageManager ?? 'npm',
      rootDirectory,
      installDirectory: lockHere ? rootDirectory : '',
      installCommand: eff.installCommand,
      buildCommand: eff.buildCommand,
      startCommand: eff.startCommand,
      outputDirectory: '.',
      port: eff.port,
    });
  }
  if (detection.runtime === 'python') {
    return pythonServiceBuild({ rootDirectory, installCommand: eff.installCommand, buildCommand: eff.buildCommand, startCommand: eff.startCommand, port: eff.port });
  }
  if (detection.runtime === 'go') {
    return goServiceBuild({ rootDirectory, installCommand: eff.installCommand, buildCommand: eff.buildCommand, startCommand: eff.startCommand === './app' ? '/app/app' : eff.startCommand, port: eff.port });
  }
  throw new Error('Could not detect how to build this project. Add a Dockerfile to the repository (or set its path in the project settings).');
}

/** Static deployments are live as soon as their files are uploaded. */
async function markReady(ctx: WorkerContext, deployment: Deployment, project: Project, extra: { fileCount: number }) {
  const now = new Date();
  const promoted = deployment.environment === 'production';
  const done = await withOutbox(ctx.db, async (tx) => {
    const updated = await tx
      .update(deployments)
      .set({ status: DeploymentStatus.READY, fileCount: extra.fileCount, buildFinishedAt: now, readyAt: now, updatedAt: now })
      .where(and(eq(deployments.id, deployment.id), eq(deployments.status, DeploymentStatus.BUILDING)))
      .returning({ id: deployments.id });
    if (updated.length === 0) return false;
    let previous: string | null = null;
    if (promoted) {
      if (connectorEnabled()) {
        const [current] = await tx.select({ id: projects.currentDeploymentId }).from(projects).where(eq(projects.id, project.id));
        previous = current?.id ?? null;
      }
      await tx.update(projects).set({ currentDeploymentId: deployment.id, sleepingAt: null, updatedAt: now }).where(eq(projects.id, project.id));
    }
    // Exactly once per transition, in the same transaction as the status change: ready first, then promoted.
    await emitDeploymentEvent(tx, deployment.id, 'ready');
    if (promoted && previous !== deployment.id) await emitDeploymentEvent(tx, deployment.id, 'promoted', undefined, { previousDeploymentId: previous });
    return true;
  });
  if (!done) throw new CanceledError();
  await publishRouteInvalidation(ctx.redis, { projectId: project.id });
}
