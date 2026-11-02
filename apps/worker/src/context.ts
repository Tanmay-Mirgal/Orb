import {
  createLogger,
  createMaintenanceQueue,
  createRedis,
  createReleaseQueue,
  LogStore,
  RunnerClient,
  type Logger,
  type Redis,
  type ReleaseQueue,
} from 'core';
import { createDb, type Database } from 'database';
import type { Queue } from 'bullmq';
import { createStorageFromEnv, type ObjectStorage } from 'storage';
import { workerConfig, type WorkerConfig } from './config';

/** Everything the job handlers need, created once per worker process. */
export interface WorkerContext {
  config: WorkerConfig;
  logger: Logger;
  db: Database;
  closeDb: () => Promise<void>;
  redis: Redis;
  logs: LogStore;
  storage: ObjectStorage;
  releaseQueue: ReleaseQueue;
  maintenanceQueue: Queue;
  runners: RunnerClient;
}

export function createContext(): WorkerContext {
  const redis = createRedis('worker');
  const { db, sql } = createDb(undefined, { max: Number(process.env.DATABASE_POOL_MAX ?? 8) });
  return {
    config: workerConfig(),
    logger: createLogger('worker'),
    db,
    closeDb: () => sql.end({ timeout: 5 }),
    redis,
    logs: new LogStore(redis),
    storage: createStorageFromEnv(),
    releaseQueue: createReleaseQueue(redis),
    maintenanceQueue: createMaintenanceQueue(redis),
    runners: new RunnerClient(redis),
  };
}
