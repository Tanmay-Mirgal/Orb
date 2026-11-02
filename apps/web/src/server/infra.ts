import {
  createBuildQueue,
  createMaintenanceQueue,
  createRedis,
  createReleaseQueue,
  LogStore,
  type BuildQueue,
  type ReleaseQueue,
  type Redis,
} from 'core';
import type { Queue } from 'bullmq';
import { createStorageFromEnv, type ObjectStorage } from 'storage';

/** Process-wide singletons for Redis, queues and object storage (lazy; safe across hot reloads). */
interface Infra {
  redis?: Redis;
  buildQueue?: BuildQueue;
  releaseQueue?: ReleaseQueue;
  maintenanceQueue?: Queue;
  logs?: LogStore;
  storage?: ObjectStorage;
}

const g = globalThis as unknown as { __orbInfra?: Infra };
const infra: Infra = (g.__orbInfra ??= {});

export function getRedis(): Redis {
  return (infra.redis ??= createRedis('web'));
}

export function getBuildQueue(): BuildQueue {
  return (infra.buildQueue ??= createBuildQueue(getRedis()));
}

export function getReleaseQueue(): ReleaseQueue {
  return (infra.releaseQueue ??= createReleaseQueue(getRedis()));
}

export function getMaintenanceQueue(): Queue {
  return (infra.maintenanceQueue ??= createMaintenanceQueue(getRedis()));
}

export function getLogStore(): LogStore {
  return (infra.logs ??= new LogStore(getRedis()));
}

export function getStorage(): ObjectStorage {
  return (infra.storage ??= createStorageFromEnv());
}
