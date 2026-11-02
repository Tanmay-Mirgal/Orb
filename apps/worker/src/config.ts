import * as os from 'node:os';
import * as path from 'node:path';
import { env, envInt } from 'core';

export function workerConfig() {
  return {
    workDir: env('WORKER_WORKDIR') ?? path.join(os.tmpdir(), 'orb-builds'),
    buildConcurrency: envInt('WORKER_CONCURRENCY', 2),
    releaseConcurrency: envInt('RELEASE_CONCURRENCY', 4),
    opsPort: envInt('WORKER_OPS_PORT', 9101),
    /** e.g. `registry.example.com/orb`. Empty = single-node mode, images stay in the local Docker daemon. */
    registry: (env('REGISTRY_URL') ?? '').replace(/\/+$/, ''),
    registryUsername: env('REGISTRY_USERNAME'),
    registryPassword: env('REGISTRY_PASSWORD'),
    maxSiteFiles: envInt('MAX_SITE_FILES', 20_000),
    maxSiteBytes: envInt('MAX_SITE_MB', 500) * 1024 * 1024,
    maxSiteFileBytes: envInt('MAX_SITE_FILE_MB', 100) * 1024 * 1024,
    drainDelayMs: envInt('DRAIN_DELAY_SECONDS', 20) * 1000,
    startTimeoutMs: envInt('INSTANCE_START_TIMEOUT_SECONDS', 300) * 1000,
  };
}

export type WorkerConfig = ReturnType<typeof workerConfig>;
