import { connectorConfig, connectorEnabled, type WebhookUrlPolicy } from 'core';
import {
  deployments,
  emitServiceEvent,
  eq,
  instances,
  projects,
  runConnectorDispatch,
  runConnectorRetention,
  withOutbox,
  type Executor,
} from 'database';
import type { WorkerContext } from '../context';

/** Connector work that runs in the worker: webhook delivery, retention and the `service.*` events. */

export function webhookPolicy(): WebhookUrlPolicy {
  return { production: process.env.NODE_ENV === 'production', allowPrivate: connectorConfig().allowPrivateWebhooks };
}

/** One tick of the dispatcher: fan new events out to endpoints, then deliver whatever is due. */
export async function runWebhookDispatch(ctx: WorkerContext) {
  return runConnectorDispatch(ctx.db, { policy: webhookPolicy() });
}

export async function runRetention(ctx: WorkerContext) {
  return runConnectorRetention(ctx.db);
}

const UNHEALTHY_SET = 'orb:cp1:unhealthy';
const LOST_WINDOW_MS = 10 * 60_000;
/** At most one `service.unhealthy` per project every 10 minutes, however often an instance flaps. */
const UNHEALTHY_COOLDOWN_SECONDS = 600;

export interface InstanceCounts {
  desired: number;
  running: number;
  unhealthy: number;
  lost: number;
}

export async function instanceCounts(tx: Executor, deploymentId: string): Promise<InstanceCounts> {
  const [deployment] = await tx.select({ config: deployments.config }).from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
  const rows = await tx
    .select({ status: instances.status, stoppedAt: instances.stoppedAt })
    .from(instances)
    .where(eq(instances.deploymentId, deploymentId));
  const recentlyLost = Date.now() - LOST_WINDOW_MS;
  return {
    desired: deployment?.config?.instanceCount ?? 1,
    running: rows.filter((r) => r.status === 'RUNNING').length,
    unhealthy: rows.filter((r) => r.status === 'UNHEALTHY').length,
    lost: rows.filter((r) => r.status === 'LOST' && (r.stoppedAt?.getTime() ?? 0) > recentlyLost).length,
  };
}

/** Is this instance's trouble worth an event: it belongs to the live deployment and the project is not on cooldown. */
export async function shouldAnnounceUnhealthy(ctx: WorkerContext, instance: { projectId: string; deploymentId: string }): Promise<boolean> {
  if (!connectorEnabled()) return false;
  const [project] = await ctx.db.select({ current: projects.currentDeploymentId }).from(projects).where(eq(projects.id, instance.projectId)).limit(1);
  if (project?.current !== instance.deploymentId) return false;
  const first = await ctx.redis.set(`orb:cp1:svc:${instance.projectId}`, '1', 'EX', UNHEALTHY_COOLDOWN_SECONDS, 'NX');
  if (!first) return false;
  await ctx.redis.sadd(UNHEALTHY_SET, instance.projectId);
  return true;
}

/** Writes the instance status change and its `service.unhealthy` event in one transaction. */
export async function markInstance(
  ctx: WorkerContext,
  instance: { id: string; projectId: string; deploymentId: string },
  patch: Partial<typeof instances.$inferInsert>,
  announce: boolean,
): Promise<void> {
  await withOutbox(ctx.db, async (tx) => {
    await tx.update(instances).set(patch).where(eq(instances.id, instance.id));
    if (announce) await emitServiceEvent(tx, instance.projectId, 'unhealthy', await instanceCounts(tx, instance.deploymentId));
  });
}

/** `service.recovered` once every instance of a project that was reported unhealthy is running again. */
export async function checkServiceRecovery(ctx: WorkerContext): Promise<number> {
  if (!connectorEnabled()) return 0;
  let recovered = 0;
  for (const projectId of await ctx.redis.smembers(UNHEALTHY_SET)) {
    const [project] = await ctx.db.select({ current: projects.currentDeploymentId, sleepingAt: projects.sleepingAt }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || !project.current || project.sleepingAt) {
      await ctx.redis.srem(UNHEALTHY_SET, projectId);
      continue;
    }
    const deploymentId = project.current;
    const counts = await instanceCounts(ctx.db, deploymentId);
    // Replacements of lost instances are new rows: healthy means "enough running, none unhealthy".
    if (counts.running >= counts.desired && counts.unhealthy === 0) {
      await withOutbox(ctx.db, (tx) => emitServiceEvent(tx, projectId, 'recovered', counts));
      await ctx.redis.srem(UNHEALTHY_SET, projectId);
      recovered++;
    }
  }
  return recovered;
}

