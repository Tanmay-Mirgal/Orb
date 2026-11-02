import type { Job } from 'bullmq';
import { enqueueRelease, publishRouteInvalidation } from 'core';
import {
  and,
  asc,
  deployments,
  desc,
  domains,
  eq,
  inArray,
  instances,
  isNull,
  lt,
  or,
  organizations,
  projects,
  refreshDomain,
  sql,
  usageHourly,
} from 'database';
import {
  DeploymentStatus,
  getInstancePlan,
  getOrgPlan,
  REDIS_KEYS,
  METRIC_FIELDS,
  type DrainJob,
  type RunnerRunOncePayload,
  type RunnerRunOnceResult,
} from 'shared';
import { storageKeys } from 'storage';
import type { WorkerContext } from '../context';
import { ACTIVE_INSTANCE_STATUSES, listLiveNodes, pickNodes } from '../orchestrator/nodes';
import { drainDeployment, stopInstances } from '../orchestrator/release';

export const SCHEDULERS = {
  'domain-check': 5 * 60_000,
  'metrics-flush': 60_000,
  reconcile: 30_000,
  reaper: 5 * 60_000,
  gc: 60 * 60_000,
  'cron-sync': 60_000,
} as const;

export async function runMaintenanceJob(ctx: WorkerContext, job: Job): Promise<unknown> {
  switch (job.name) {
    case 'domain-check':
      return checkDomains(ctx);
    case 'metrics-flush':
      return flushMetrics(ctx);
    case 'reconcile':
      return reconcileInstances(ctx);
    case 'reaper':
      return reapStuckDeployments(ctx);
    case 'gc':
      return garbageCollect(ctx);
    case 'cron-sync':
      return syncCronSchedules(ctx);
    case 'cron-run':
      return runCron(ctx, job.data as { projectId: string });
    case 'drain':
      return drainDeployment(ctx, (job.data as DrainJob).deploymentId);
    case 'teardown-project':
      return teardownProject(ctx, job.data as TeardownPayload);
    default:
      ctx.logger.warn({ name: job.name }, 'unknown maintenance job');
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Custom domains: poll DNS for unverified domains, re-check active ones for drift.
// ---------------------------------------------------------------------------
async function checkDomains(ctx: WorkerContext) {
  const staleActive = new Date(Date.now() - 6 * 3_600_000);
  const stalePending = new Date(Date.now() - 2 * 60_000);
  const rows = await ctx.db
    .select()
    .from(domains)
    .where(
      or(
        and(inArray(domains.status, ['pending', 'verified', 'error']), or(isNull(domains.lastCheckedAt), lt(domains.lastCheckedAt, stalePending))),
        and(eq(domains.status, 'active'), or(isNull(domains.lastCheckedAt), lt(domains.lastCheckedAt, staleActive))),
      ),
    )
    .limit(200);
  let changed = 0;
  for (const row of rows) {
    try {
      const result = await refreshDomain(ctx.db, row);
      if (result.changed) {
        changed++;
        await publishRouteInvalidation(ctx.redis, { projectId: row.projectId });
      }
    } catch (err) {
      ctx.logger.warn({ domain: row.domain, err: String(err) }, 'domain check failed');
    }
  }
  return { checked: rows.length, changed };
}

// ---------------------------------------------------------------------------
// Analytics: move per-hour counters written by the edge from Redis into Postgres.
// ---------------------------------------------------------------------------
async function flushMetrics(ctx: WorkerContext) {
  const members = await ctx.redis.smembers(REDIS_KEYS.metricsIndex);
  let flushed = 0;
  for (const member of members) {
    const [projectId, bucketIso] = member.split('|');
    if (!projectId || !bucketIso) {
      await ctx.redis.srem(REDIS_KEYS.metricsIndex, member);
      continue;
    }
    const key = REDIS_KEYS.metricsBucket(projectId, bucketIso);
    const tmp = `${key}:flushing`;
    try {
      await ctx.redis.rename(key, tmp);
    } catch {
      await ctx.redis.srem(REDIS_KEYS.metricsIndex, member); // already flushed / expired
      continue;
    }
    await ctx.redis.srem(REDIS_KEYS.metricsIndex, member);
    const counters = await ctx.redis.hgetall(tmp);
    try {
      const [exists] = await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
      if (exists) {
        const n = (f: string) => Number(counters[f] ?? 0);
        await ctx.db
          .insert(usageHourly)
          .values({
            projectId,
            bucket: new Date(bucketIso),
            requests: n('requests'),
            bytesOut: n('bytesOut'),
            status2xx: n('s2xx'),
            status3xx: n('s3xx'),
            status4xx: n('s4xx'),
            status5xx: n('s5xx'),
            durationMsTotal: n('durationMs'),
          })
          .onConflictDoUpdate({
            target: [usageHourly.projectId, usageHourly.bucket],
            set: {
              requests: sql`${usageHourly.requests} + ${n('requests')}`,
              bytesOut: sql`${usageHourly.bytesOut} + ${n('bytesOut')}`,
              status2xx: sql`${usageHourly.status2xx} + ${n('s2xx')}`,
              status3xx: sql`${usageHourly.status3xx} + ${n('s3xx')}`,
              status4xx: sql`${usageHourly.status4xx} + ${n('s4xx')}`,
              status5xx: sql`${usageHourly.status5xx} + ${n('s5xx')}`,
              durationMsTotal: sql`${usageHourly.durationMsTotal} + ${n('durationMs')}`,
            },
          });
        flushed++;
      }
      await ctx.redis.del(tmp);
    } catch (err) {
      // Give the counters back so the next run retries instead of losing them.
      const pipeline = ctx.redis.pipeline();
      for (const field of METRIC_FIELDS) if (counters[field]) pipeline.hincrby(key, field, Number(counters[field]));
      pipeline.sadd(REDIS_KEYS.metricsIndex, member).del(tmp);
      await pipeline.exec();
      ctx.logger.warn({ err: String(err) }, 'metrics flush failed; counters restored');
    }
  }
  return { flushed };
}

// ---------------------------------------------------------------------------
// Self-healing: compare scheduled instances with what the runner nodes actually report.
// ---------------------------------------------------------------------------
async function reconcileInstances(ctx: WorkerContext) {
  const active = await ctx.db.select().from(instances).where(inArray(instances.status, ACTIVE_INSTANCE_STATUSES));
  if (active.length === 0) return { lost: 0 };
  const nodes = new Map((await listLiveNodes(ctx)).map((n) => [n.id, n]));
  const now = Date.now();
  const affected = new Map<string, string>(); // deploymentId -> projectId
  let lost = 0;

  for (const inst of active) {
    const age = now - inst.updatedAt.getTime();
    const node = nodes.get(inst.nodeId);
    let next: string | null = null;
    if (!node) {
      if (age > 60_000) next = 'LOST'; // node stopped heart-beating
    } else if (inst.status !== 'STARTING' || age > 10 * 60_000) {
      const container = inst.containerId ? node.containers.find((c) => c.containerId === inst.containerId) : undefined;
      if (!container) next = 'LOST';
      else if (container.state !== 'running') next = 'UNHEALTHY';
      else if (inst.status === 'UNHEALTHY') next = 'RUNNING';
    }
    if (next && next !== inst.status) {
      await ctx.db
        .update(instances)
        .set({ status: next, updatedAt: new Date(), ...(next === 'LOST' ? { stoppedAt: new Date() } : {}) })
        .where(eq(instances.id, inst.id));
      affected.set(inst.deploymentId, inst.projectId);
      if (next === 'LOST') lost++;
    }
  }

  for (const [deploymentId, projectId] of affected) {
    await publishRouteInvalidation(ctx.redis, { projectId });
    const [dep] = await ctx.db.select({ status: deployments.status }).from(deployments).where(eq(deployments.id, deploymentId));
    if (dep?.status !== DeploymentStatus.READY) continue;
    // Reschedule replacements at most once a minute per deployment.
    const first = await ctx.redis.set(`orb:reschedule:${deploymentId}`, '1', 'EX', 60, 'NX');
    if (first) {
      ctx.logger.warn({ deploymentId }, 'instances lost: rescheduling');
      await enqueueRelease(ctx.releaseQueue, deploymentId, false);
    }
  }
  return { lost };
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
async function reapStuckDeployments(ctx: WorkerContext) {
  const ago = (ms: number) => new Date(Date.now() - ms);
  const stuck = await ctx.db
    .update(deployments)
    .set({ status: DeploymentStatus.FAILED, errorMessage: 'Timed out: the deployment stopped making progress', updatedAt: new Date() })
    .where(
      or(
        and(eq(deployments.status, DeploymentStatus.BUILDING), lt(deployments.updatedAt, ago(2 * 3_600_000))),
        and(eq(deployments.status, DeploymentStatus.DEPLOYING), lt(deployments.updatedAt, ago(30 * 60_000))),
        and(eq(deployments.status, DeploymentStatus.QUEUED), lt(deployments.updatedAt, ago(3_600_000))),
      ),
    )
    .returning({ id: deployments.id });
  return { reaped: stuck.length };
}

/** Keeps the live deployment plus the newest N per project; older artifacts are deleted and marked ARCHIVED. */
async function garbageCollect(ctx: WorkerContext) {
  const rows = await ctx.db
    .select({ id: projects.id, current: projects.currentDeploymentId, plan: organizations.plan })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .limit(1000);
  let archived = 0;
  for (const project of rows) {
    const keep = getOrgPlan(project.plan).retainedDeployments;
    const old = await ctx.db
      .select({ id: deployments.id, type: deployments.config })
      .from(deployments)
      .where(and(eq(deployments.projectId, project.id), eq(deployments.status, DeploymentStatus.READY)))
      .orderBy(desc(deployments.createdAt))
      .offset(keep)
      .limit(100);
    for (const dep of old) {
      if (dep.id === project.current) continue;
      await drainDeployment(ctx, dep.id);
      await ctx.storage.deletePrefix(storageKeys.sitePrefix(dep.id)).catch(() => 0);
      await ctx.db.update(deployments).set({ status: DeploymentStatus.ARCHIVED, updatedAt: new Date() }).where(eq(deployments.id, dep.id));
      archived++;
    }
  }
  return { archived };
}

interface TeardownPayload {
  projectId: string;
  deploymentIds: string[];
  instances: Array<{ nodeId: string; containerId: string | null }>;
}

async function teardownProject(ctx: WorkerContext, payload: TeardownPayload) {
  await stopInstances(
    ctx,
    payload.instances.map((i, idx) => ({ id: `${payload.projectId}-${idx}`, nodeId: i.nodeId, containerId: i.containerId })),
  ).catch(() => undefined);
  for (const id of payload.deploymentIds) {
    await ctx.storage.deletePrefix(storageKeys.sitePrefix(id)).catch(() => 0);
    await ctx.storage.delete(storageKeys.buildLog(id)).catch(() => undefined);
    await ctx.redis.del(REDIS_KEYS.buildLogs(id), REDIS_KEYS.runtimeLogs(id));
  }
  await ctx.maintenanceQueue.removeJobScheduler(`cron:${payload.projectId}`).catch(() => false);
  return { deployments: payload.deploymentIds.length };
}

// ---------------------------------------------------------------------------
// Cron jobs: one BullMQ job scheduler per cron project, run as a one-off container on a runner node.
// ---------------------------------------------------------------------------
async function syncCronSchedules(ctx: WorkerContext) {
  const rows = await ctx.db
    .select({ id: projects.id, schedule: projects.cronSchedule, current: projects.currentDeploymentId })
    .from(projects)
    .where(eq(projects.type, 'cron'))
    .orderBy(asc(projects.createdAt));
  const wanted = new Set<string>();
  for (const row of rows) {
    if (!row.schedule || !row.current) continue;
    wanted.add(`cron:${row.id}`);
    try {
      await ctx.maintenanceQueue.upsertJobScheduler(`cron:${row.id}`, { pattern: row.schedule }, { name: 'cron-run', data: { projectId: row.id } });
    } catch (err) {
      ctx.logger.warn({ project: row.id, err: String(err) }, 'invalid cron schedule');
    }
  }
  for (const scheduler of await ctx.maintenanceQueue.getJobSchedulers(0, 5000)) {
    if (scheduler.key.startsWith('cron:') && !wanted.has(scheduler.key)) await ctx.maintenanceQueue.removeJobScheduler(scheduler.key);
  }
  return { schedulers: wanted.size };
}

async function runCron(ctx: WorkerContext, data: { projectId: string }) {
  const [row] = await ctx.db
    .select({ project: projects, deployment: deployments })
    .from(projects)
    .innerJoin(deployments, eq(deployments.id, projects.currentDeploymentId))
    .where(eq(projects.id, data.projectId));
  if (!row?.deployment.imageRef || !row.deployment.config) return { skipped: 'no live deployment' };

  const timeoutSec = 3600;
  const locked = await ctx.redis.set(`orb:cron:${data.projectId}`, '1', 'EX', timeoutSec + 60, 'NX');
  if (!locked) return { skipped: 'previous run still active' };
  try {
    const plan = getInstancePlan(row.deployment.config.instancePlan);
    const [nodeId] = await pickNodes(ctx, 1, { cpuMillis: plan.cpuMillis, memoryMb: plan.memoryMb });
    const payload: RunnerRunOncePayload = {
      deploymentId: row.deployment.id,
      projectId: data.projectId,
      image: row.deployment.imageRef,
      command: row.deployment.config.startCommand ?? undefined,
      cpuMillis: plan.cpuMillis,
      memoryMb: plan.memoryMb,
      timeoutSec,
      environment: 'production',
    };
    return await ctx.runners.call<RunnerRunOnceResult>(nodeId!, 'run-once', payload, (timeoutSec + 120) * 1000);
  } finally {
    await ctx.redis.del(`orb:cron:${data.projectId}`);
  }
}
