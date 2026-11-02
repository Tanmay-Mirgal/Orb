import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { deploymentUrl, publishRouteInvalidation } from 'core';
import {
  and,
  deployments,
  eq,
  inArray,
  instances,
  organizations,
  projects,
  type Deployment,
  type Project,
} from 'database';
import {
  DeploymentStatus,
  getInstancePlan,
  type DrainJob,
  type ReleaseJob,
  type RunnerStartPayload,
  type RunnerStartResult,
  type RunnerStopPayload,
} from 'shared';
import { storageKeys } from 'storage';
import { BuildLog } from '../build/buildlog';
import type { WorkerContext } from '../context';
import { notifyDeployment } from '../notifications';
import { ACTIVE_INSTANCE_STATUSES, pickNodes } from './nodes';

async function stopInstances(ctx: WorkerContext, rows: Array<{ id: string; nodeId: string; containerId: string | null }>) {
  await Promise.allSettled(
    rows.map(async (row) => {
      if (row.containerId) {
        const payload: RunnerStopPayload = { containerId: row.containerId, gracePeriodSec: 30 };
        await ctx.runners.call(row.nodeId, 'stop', payload, 90_000).catch((err) => {
          ctx.logger.warn({ instance: row.id, node: row.nodeId, err: String(err) }, 'stop failed (container may already be gone)');
        });
      }
      await ctx.db.update(instances).set({ status: 'STOPPED', stoppedAt: new Date(), updatedAt: new Date() }).where(eq(instances.id, row.id));
    }),
  );
}

async function archiveLog(ctx: WorkerContext, deploymentId: string) {
  const { lines } = await ctx.logs.readBuild(deploymentId, 0);
  if (lines.length > 0) {
    await ctx.storage.put(storageKeys.buildLog(deploymentId), lines.join('\n') + '\n', { contentType: 'text/plain; charset=utf-8' }).catch(() => undefined);
  }
}

/**
 * Release = make sure a built deployment has its desired number of healthy instances, then (optionally)
 * switch production traffic to it. The old deployment keeps serving until the new one is healthy, so a
 * failed release never causes downtime. Idempotent: running it again only tops up missing instances.
 */
export async function runReleaseJob(ctx: WorkerContext, job: Job<ReleaseJob>): Promise<void> {
  const { db } = ctx;
  const [row] = await db
    .select({ deployment: deployments, project: projects, orgPlan: organizations.plan })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(deployments.id, job.data.deploymentId))
    .limit(1);
  if (!row) return;
  const { deployment, project } = row;
  if (([DeploymentStatus.FAILED, DeploymentStatus.CANCELED, DeploymentStatus.ARCHIVED] as string[]).includes(deployment.status)) return;

  const log = new BuildLog(ctx.logs, deployment.id);
  try {
    const config = deployment.config;
    if (!config) throw new Error('Deployment has no configuration snapshot');

    if (config.type === 'cron') {
      await markReady(ctx, deployment, project, job.data.promote);
      log.line(`[orb] ✓ Cron job ready — schedule "${config.cronSchedule}" (executed by the scheduler worker)`);
      if (deployment.status === DeploymentStatus.DEPLOYING) await notifyDeployment(ctx, deployment.id, 'ready');
      return;
    }
    if (!deployment.imageRef) throw new Error('Deployment has no image to run');

    const plan = getInstancePlan(config.instancePlan);
    const active = await db
      .select()
      .from(instances)
      .where(and(eq(instances.deploymentId, deployment.id), inArray(instances.status, ACTIVE_INSTANCE_STATUSES)));
    const missing = Math.max(0, config.instanceCount - active.length);

    const startedHere: Array<{ id: string; nodeId: string; containerId: string | null }> = [];
    if (missing > 0) {
      log.line(`[scheduler] Starting ${missing} instance(s) (${plan.name}: ${plan.cpuMillis}m CPU, ${plan.memoryMb} MB)`);
      const nodeIds = await pickNodes(ctx, missing, { cpuMillis: plan.cpuMillis, memoryMb: plan.memoryMb });
      const results = await Promise.allSettled(
        nodeIds.map(async (nodeId) => {
          const instanceId = randomUUID();
          await db.insert(instances).values({
            id: instanceId,
            deploymentId: deployment.id,
            projectId: project.id,
            nodeId,
            status: 'STARTING',
            cpuMillis: plan.cpuMillis,
            memoryMb: plan.memoryMb,
          });
          startedHere.push({ id: instanceId, nodeId, containerId: null });
          const payload: RunnerStartPayload = {
            deploymentId: deployment.id,
            projectId: project.id,
            instanceId,
            type: config.type,
            environment: deployment.environment === 'preview' ? 'preview' : 'production',
            image: deployment.imageRef!,
            port: config.port,
            healthCheckPath: config.healthCheckPath || '/',
            healthCheckTimeoutSec: 90,
            cpuMillis: plan.cpuMillis,
            memoryMb: plan.memoryMb,
            commitSha: deployment.commitHash,
            branch: deployment.branch,
            publicUrl: deploymentUrl(deployment.subdomain ?? project.slug ?? ''),
          };
          const started = await ctx.runners.call<RunnerStartResult>(nodeId, 'start', payload, ctx.config.startTimeoutMs);
          await db
            .update(instances)
            .set({ status: 'RUNNING', containerId: started.containerId, address: started.address, hostPort: started.hostPort, updatedAt: new Date() })
            .where(eq(instances.id, instanceId));
          const mine = startedHere.find((s) => s.id === instanceId);
          if (mine) mine.containerId = started.containerId;
          log.line(`[scheduler] ✓ Instance ${instanceId.slice(0, 8)} healthy on ${nodeId} (${started.address}:${started.hostPort})`);
        }),
      );
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length > 0) {
        for (const f of failures) log.line(`[scheduler] ✗ ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);
        await stopInstances(ctx, startedHere);
        throw new Error('Could not start every instance; the previous deployment keeps serving traffic');
      }
    } else {
      log.line('[scheduler] Instances already running');
    }

    await markReady(ctx, deployment, project, job.data.promote);
    if (job.data.wake) {
      // The service was asleep: it is serving again, so let the edge route to the fresh instances right away.
      await db.update(projects).set({ sleepingAt: null, updatedAt: new Date() }).where(eq(projects.id, project.id));
      await publishRouteInvalidation(ctx.redis, { projectId: project.id });
    }
    log.line(job.data.wake ? '[orb] ✓ Woke up from sleep' : job.data.promote ? '[orb] ✓ Live: traffic switched to the new deployment' : '[orb] ✓ Ready (preview)');
    if (deployment.status === DeploymentStatus.DEPLOYING) await notifyDeployment(ctx, deployment.id, 'ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.line(`[error] ${message}`);
    ctx.logger.warn({ deploymentId: deployment.id, err: message }, 'release failed');
    // A deployment that was already serving stays READY; only a first release is marked failed.
    if (deployment.status === DeploymentStatus.DEPLOYING) {
      await db
        .update(deployments)
        .set({ status: DeploymentStatus.FAILED, errorMessage: message.slice(0, 2000), updatedAt: new Date() })
        .where(and(eq(deployments.id, deployment.id), eq(deployments.status, DeploymentStatus.DEPLOYING)));
      await notifyDeployment(ctx, deployment.id, 'failed');
    }
    throw err;
  } finally {
    await log.flush();
    await archiveLog(ctx, deployment.id);
  }
}

async function markReady(ctx: WorkerContext, deployment: Deployment, project: Project, promote: boolean) {
  const { db } = ctx;
  const now = new Date();
  const [fresh] = await db.select({ status: deployments.status }).from(deployments).where(eq(deployments.id, deployment.id));
  if (fresh?.status === DeploymentStatus.CANCELED) throw new Error('Deployment was canceled');
  await db
    .update(deployments)
    .set({ status: DeploymentStatus.READY, readyAt: deployment.readyAt ?? now, buildFinishedAt: deployment.buildFinishedAt ?? now, updatedAt: now })
    .where(eq(deployments.id, deployment.id));

  if (promote) {
    const [current] = await db.select({ id: projects.currentDeploymentId }).from(projects).where(eq(projects.id, project.id));
    const previous = current?.id ?? null;
    await db.update(projects).set({ currentDeploymentId: deployment.id, sleepingAt: null, updatedAt: now }).where(eq(projects.id, project.id));
    await publishRouteInvalidation(ctx.redis, { projectId: project.id });
    if (previous && previous !== deployment.id) {
      const payload: DrainJob = { deploymentId: previous };
      await ctx.maintenanceQueue.add('drain', payload, { delay: ctx.config.drainDelayMs });
    }
  } else if (deployment.environment === 'preview' && deployment.branch) {
    // A newer preview of the same branch replaces older ones.
    const older = await db
      .select({ id: deployments.id })
      .from(deployments)
      .where(and(eq(deployments.projectId, project.id), eq(deployments.environment, 'preview'), eq(deployments.branch, deployment.branch), eq(deployments.status, DeploymentStatus.READY)));
    for (const o of older.filter((d) => d.id !== deployment.id)) {
      const payload: DrainJob = { deploymentId: o.id };
      await ctx.maintenanceQueue.add('drain', payload, { delay: ctx.config.drainDelayMs });
    }
  }
}

/** Stops every active instance of a deployment (used after traffic moved away, and by garbage collection). */
export async function drainDeployment(ctx: WorkerContext, deploymentId: string): Promise<number> {
  const [dep] = await ctx.db.select({ projectId: deployments.projectId }).from(deployments).where(eq(deployments.id, deploymentId));
  if (dep) {
    const [project] = await ctx.db.select({ current: projects.currentDeploymentId }).from(projects).where(eq(projects.id, dep.projectId));
    if (project?.current === deploymentId) return 0; // became the live deployment again (rollback): keep it
  }
  const rows = await ctx.db
    .select({ id: instances.id, nodeId: instances.nodeId, containerId: instances.containerId })
    .from(instances)
    .where(and(eq(instances.deploymentId, deploymentId), inArray(instances.status, ACTIVE_INSTANCE_STATUSES)));
  await stopInstances(ctx, rows);
  if (dep) await publishRouteInvalidation(ctx.redis, { projectId: dep.projectId });
  return rows.length;
}

export { stopInstances };
