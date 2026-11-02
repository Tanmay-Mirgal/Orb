import { Redis, type RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { env } from './config';

export type { Redis };

export function redisUrl(): string {
  return env('REDIS_URL') ?? `redis://${env('REDIS_HOST') ?? 'localhost'}:${env('REDIS_PORT') ?? '6379'}`;
}

/**
 * Creates a Redis client. `maxRetriesPerRequest: null` is required by BullMQ's blocking
 * connections and is harmless for plain commands (they queue while reconnecting).
 */
export function createRedis(name: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(redisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `orb:${name}`,
    password: env('REDIS_PASSWORD'),
    ...overrides,
  });
  client.on('error', (err) => {
    // ioredis retries on its own; make sure the failure is visible without crashing the process.
    console.error(JSON.stringify({ level: 'error', msg: 'redis error', client: name, err: err.message }));
  });
  return client;
}

/** BullMQ bundles its own ioredis typings; the runtime object is compatible. */
export function bullConnection(client: Redis): ConnectionOptions {
  return client as unknown as ConnectionOptions;
}
