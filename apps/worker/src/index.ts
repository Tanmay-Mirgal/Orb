import { Worker } from 'bullmq';
import { assertConnectorConfig, bullConnection, createMetrics, loadEnv, startOpsServer } from 'core';
import { sql } from 'database';
import { QUEUES } from 'shared';
import { runBuildJob } from './build/pipeline';
import { runProcess } from './build/docker-login';
import { createContext } from './context';
import { runMaintenanceJob, SCHEDULERS } from './jobs/maintenance';
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

  // Repeatable platform jobs. upsertJobScheduler is idempotent, so every worker instance can call it.
  for (const [name, every] of Object.entries(SCHEDULERS)) {
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
      Promise.all([builds.close(), releases.close(), maintenance.close()]),
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
