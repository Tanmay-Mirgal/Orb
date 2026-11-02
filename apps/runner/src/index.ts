import { Worker } from 'bullmq';
import { bullConnection, createLogger, createMetrics, createRedis, loadEnv, LogStore, startOpsServer } from 'core';
import {
  NODE_HEARTBEAT_TTL_SECONDS,
  QUEUES,
  REDIS_KEYS,
  type NodeHeartbeat,
  type RunnerCommand,
  type RunnerRunOncePayload,
  type RunnerStartPayload,
  type RunnerStopPayload,
} from 'shared';
import { runnerConfig } from './config';
import { ContainerManager } from './containers';

loadEnv();

async function main() {
  const config = runnerConfig();
  const logger = createLogger(`runner:${config.nodeId}`);
  if (!config.internalToken) throw new Error('INTERNAL_API_TOKEN is required (shared with the control plane)');

  const redis = createRedis('runner');
  const manager = new ContainerManager(config, new LogStore(redis), logger);
  await manager.ping();
  await manager.ensureNetwork();
  const resumed = await manager.reattachAll();
  logger.info({ resumed, capacity: config.capacity, address: config.address }, 'runner node ready');

  const startedAt = new Date().toISOString();
  let draining = false;

  const heartbeat = async () => {
    const containers = await manager.inventory().catch(() => []);
    const beat: NodeHeartbeat = {
      id: config.nodeId,
      address: config.address,
      capacity: config.capacity,
      draining,
      version: config.version,
      startedAt,
      ts: Date.now(),
      containers,
    };
    await redis
      .multi()
      .set(REDIS_KEYS.node(config.nodeId), JSON.stringify(beat), 'EX', NODE_HEARTBEAT_TTL_SECONDS)
      .sadd(REDIS_KEYS.nodes, config.nodeId)
      .exec();
  };
  await heartbeat();
  const beatTimer = setInterval(() => heartbeat().catch((e) => logger.warn({ err: String(e) }, 'heartbeat failed')), 5000);
  const pruneTimer = setInterval(() => manager.prune().catch(() => undefined), 6 * 3_600_000);

  const metrics = createMetrics('runner');
  const commands = new metrics.client.Counter({ name: 'orb_runner_commands_total', help: 'Runner commands', labelNames: ['command', 'result'], registers: [metrics.registry] });
  new metrics.client.Gauge({
    name: 'orb_runner_containers',
    help: 'Managed containers on this node',
    registers: [metrics.registry],
    async collect() {
      this.set((await manager.inventory().catch(() => [])).filter((c) => c.state === 'running').length);
    },
  });

  const worker = new Worker(
    QUEUES.runner(config.nodeId),
    async (job) => {
      const command = job.name as RunnerCommand;
      try {
        let result: unknown;
        if (command === 'start') result = await manager.start(job.data as RunnerStartPayload);
        else if (command === 'stop') result = await manager.stop(job.data as RunnerStopPayload);
        else if (command === 'run-once') result = await manager.runOnce(job.data as RunnerRunOncePayload);
        else throw new Error(`Unknown command ${job.name}`);
        commands.inc({ command, result: 'ok' });
        void heartbeat();
        return result ?? { ok: true };
      } catch (err) {
        commands.inc({ command, result: 'error' });
        logger.warn({ command, err: err instanceof Error ? err.message : String(err) }, 'command failed');
        throw err;
      }
    },
    { connection: bullConnection(redis), concurrency: config.concurrency, lockDuration: 120_000 },
  );
  worker.on('error', (err) => logger.error({ err: err.message }, 'queue error'));

  const ops = startOpsServer({
    port: config.opsPort,
    metrics,
    logger,
    checks: {
      docker: () => manager.ping(),
      redis: async () => {
        await redis.ping();
      },
    },
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'runner shutting down (containers keep running)');
    draining = true;
    await heartbeat().catch(() => undefined);
    clearInterval(beatTimer);
    clearInterval(pruneTimer);
    ops.close();
    await worker.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'runner failed to start', err: err instanceof Error ? err.stack : String(err) }));
  process.exit(1);
});
