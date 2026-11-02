import type { DeploymentEnvironment, InstanceStatus, ProjectType } from './constants';

/** Payloads carried on queues. They intentionally contain no secrets: workers read those from Postgres. */

export interface BuildJob {
  deploymentId: string;
}

export interface ReleaseJob {
  deploymentId: string;
  /** Point the project's production alias at this deployment once it is healthy. */
  promote: boolean;
}

export interface DrainJob {
  /** Stop every active instance of this deployment (unless it became the live one again meanwhile). */
  deploymentId: string;
}

export interface RunnerStartPayload {
  deploymentId: string;
  projectId: string;
  instanceId: string;
  type: ProjectType;
  environment: DeploymentEnvironment;
  image: string;
  port: number;
  healthCheckPath: string;
  healthCheckTimeoutSec: number;
  cpuMillis: number;
  memoryMb: number;
  startCommand?: string;
  commitSha?: string | null;
  branch?: string | null;
  publicUrl: string;
}

export interface RunnerStartResult {
  containerId: string;
  address: string;
  hostPort: number;
}

export interface RunnerStopPayload {
  containerId: string;
  gracePeriodSec?: number;
}

export interface RunnerRunOncePayload {
  deploymentId: string;
  projectId: string;
  image: string;
  command?: string;
  cpuMillis: number;
  memoryMb: number;
  timeoutSec: number;
  environment: DeploymentEnvironment;
}

export interface RunnerRunOnceResult {
  exitCode: number;
  durationMs: number;
}

export type RunnerCommand = 'start' | 'stop' | 'run-once';

export interface NodeContainerInfo {
  containerId: string;
  deploymentId: string;
  projectId: string;
  instanceId: string;
  state: string;
  hostPort: number | null;
}

export interface NodeHeartbeat {
  id: string;
  /** Address the edge proxies use to reach instances published on this node. */
  address: string;
  capacity: { cpuMillis: number; memoryMb: number };
  draining: boolean;
  version: string;
  startedAt: string;
  ts: number;
  containers: NodeContainerInfo[];
}

export interface RouteInvalidation {
  projectId?: string;
  /** Drop everything (used after bulk changes). */
  all?: boolean;
}

export interface InstanceRoute {
  instanceId: string;
  address: string;
  port: number;
  status: InstanceStatus;
}

/** Immutable snapshot of project configuration taken when a deployment is created (redeploys/rollbacks reuse it). */
export interface DeploymentConfig {
  type: ProjectType;
  framework?: string | null;
  rootDirectory: string;
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  outputDirectory?: string | null;
  dockerfilePath?: string | null;
  port: number;
  healthCheckPath: string;
  instancePlan: string;
  instanceCount: number;
  cronSchedule?: string | null;
}
