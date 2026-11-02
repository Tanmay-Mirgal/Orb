import * as os from 'node:os';
import { env, envInt } from 'core';

export function runnerConfig() {
  const cpus = os.cpus().length;
  return {
    nodeId: env('NODE_ID') ?? os.hostname(),
    /** Address the edge proxies use to reach containers published on this node. */
    address: env('RUNNER_ADDRESS') ?? '127.0.0.1',
    /** Interface the container ports are published on. Keep it private; never 0.0.0.0 on a public NIC. */
    bindIp: env('RUNNER_BIND_IP') ?? '127.0.0.1',
    controlPlaneUrl: (env('CONTROL_PLANE_URL') ?? 'http://localhost:3000').replace(/\/+$/, ''),
    internalToken: env('INTERNAL_API_TOKEN') ?? '',
    capacity: {
      cpuMillis: envInt('RUNNER_CPU_MILLIS', Math.floor(cpus * 1000 * 0.8)),
      memoryMb: envInt('RUNNER_MEMORY_MB', Math.floor((os.totalmem() / 1024 / 1024) * 0.75)),
    },
    network: env('RUNNER_NETWORK') ?? 'orb-apps',
    opsPort: envInt('RUNNER_OPS_PORT', 9102),
    concurrency: envInt('RUNNER_CONCURRENCY', 4),
    registry: {
      url: env('REGISTRY_URL')?.split('/')[0],
      username: env('REGISTRY_USERNAME'),
      password: env('REGISTRY_PASSWORD'),
    },
    version: '2.0.0',
  };
}

export type RunnerConfig = ReturnType<typeof runnerConfig>;
