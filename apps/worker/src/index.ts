import { Queue, Worker } from 'bullmq';
import { assertConnectorConfig, bullConnection, connectorEnabled, createMetrics, loadEnv, startOpsServer } from 'core';
import { sql } from 'database';
import { QUEUES } from 'shared';
import { runBuildJob } from './build/pipeline';
import { runProcess } from './build/docker-login';
import { createContext } from './context';
import { runWebhookDispatch } from './jobs/connector-events';
import { CONNECTOR_SCHEDULERS, runMaintenanceJob, SCHEDULERS } from './jobs/maintenance';
import { runReleaseJob } from './orchestrator/release';

loadEnv();

async function main() {
  assertConnectorConfig(); // no-op unless CONNECTOR_ENABLED=true; then every CONNECTOR_* variable must be valid
  const ctx = createContext();
  const { logger, config, redis } = ctx;
  logger.info('Orb worker starting');

  await ctx.storage.ensureReady();
  if (config.registry && config.registryUsername && config.registryPassword) {
    await runProcess('docker', ['login', config.registry.split('/')[0]!, '-u', config.registryUsername, '--password-stdin'], config.registryPassword);
    logger.info({ registry: config.registry }, 'logged in to registry');
  }

  const connection = bullConnection(redis);
  const metrics = createMetrics('worker');
  const jobsTotal = new metrics.client.Counter({ name: 'orb_worker_jobs_total', help: 'Jobs processed', labelNames: ['queue', 'result'], registers: [metrics.registry] });

  const builds = new Worker(QUEUES.build, (job, token) => runBuildJob(ctx, job, token), {
    connection,
    concurrency: config.buildConcurrency,
    lockDuration: 60_000,
  });
  const releases = new Worker(QUEUES.release, (job) => runReleaseJob(ctx, job), {
    connection,
    concurrency: config.releaseConcurrency,
    lockDuration: 60_000,
  });
  const maintenance = new Worker(QUEUES.maintenance, (job) => runMaintenanceJob(ctx, job), { connection, concurrency: 4 });

  for (const [name, worker] of [['build', builds], ['release', releases], ['maintenance', maintenance]] as const) {
    worker.on('completed', () => jobsTotal.inc({ queue: name, result: 'completed' }));
    worker.on('failed', (job, err) => {
      jobsTotal.inc({ queue: name, result: 'failed' });
      logger.warn({ queue: name, job: job?.id, err: err.message }, 'job failed');
    });
    worker.on('error', (err) => logger.error({ queue: name, err: err.message }, 'worker error'));
  }

  // Ecosystem connector (CP1): webhook delivery and retention exist only while it is enabled. Several workers
  // may run the dispatcher: every claim in the database is FOR UPDATE SKIP LOCKED.
  let connectorQueue: Queue | undefined;
  let connectorWorker: Worker | undefined;
  const schedulers: Record<string, number> = { ...SCHEDULERS };
  if (connectorEnabled()) {
    Object.assign(schedulers, CONNECTOR_SCHEDULERS);
    connectorQueue = new Queue(QUEUES.connectorWebhooks, { connection, defaultJobOptions: { removeOnComplete: 20, removeOnFail: 100 } });
    connectorWorker = new Worker(QUEUES.connectorWebhooks, () => runWebhookDispatch(ctx), { connection, concurrency: 1 });
    connectorWorker.on('failed', (job, err) => logger.warn({ queue: 'connector-webhooks', job: job?.id, err: err.message }, 'connector dispatch failed'));
    connectorWorker.on('error', (err) => logger.error({ queue: 'connector-webhooks', err: err.message }, 'connector worker error'));
    await connectorQueue.upsertJobScheduler('connector-dispatch', { every: 5_000 }, { name: 'dispatch', data: {} });
    logger.info('ecosystem connector enabled: webhook dispatcher running');
  } else {
    // Switched off after having been on: stop the schedulers a previous run left behind.
    await Promise.allSettled(Object.keys(CONNECTOR_SCHEDULERS).map((name) => ctx.maintenanceQueue.removeJobScheduler(name)));
    const stale = new Queue(QUEUES.connectorWebhooks, { connection });
    await stale.removeJobScheduler('connector-dispatch').catch(() => undefined);
    await stale.close();
  }

  // Repeatable platform jobs. upsertJobScheduler is idempotent, so every worker instance can call it.
  for (const [name, every] of Object.entries(schedulers)) {
    await ctx.maintenanceQueue.upsertJobScheduler(name, { every }, { name, data: {} });
  }

  const ops = startOpsServer({
    port: config.opsPort,
    metrics,
    logger,
    checks: {
      redis: async () => {
        await redis.ping();
      },
      postgres: async () => {
        await ctx.db.execute(sql`select 1`);
      },
      storage: () => ctx.storage.ping(),
    },
  });

  logger.info({ buildConcurrency: config.buildConcurrency }, 'Orb worker ready');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down: waiting for running jobs');
    ops.close();
    // Let in-flight builds finish (up to 60 s); unfinished ones are picked up again by BullMQ's stalled-job recovery.
    await Promise.race([
      Promise.all([builds.close(), releases.close(), maintenance.close(), connectorWorker?.close(), connectorQueue?.close()]),
      new Promise((resolve) => setTimeout(resolve, 60_000)),
    ]);
    await ctx.runners.close();
    await ctx.closeDb();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'worker failed to start', err: err instanceof Error ? err.stack : String(err) }));
  process.exit(1);
});
