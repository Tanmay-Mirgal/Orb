/**
 * Domain constants shared by every Orb component (web, worker, proxy, runner).
 * This module must stay isomorphic: no Node built-ins, safe for client bundles.
 */

export const DeploymentStatus = {
  QUEUED: 'QUEUED',
  BUILDING: 'BUILDING',
  DEPLOYING: 'DEPLOYING',
  READY: 'READY',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  /** Artifacts garbage-collected; kept for history only, cannot be promoted. */
  ARCHIVED: 'ARCHIVED',
} as const;
export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

/** Statuses after which a deployment will never change on its own. */
export const TERMINAL_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.READY,
  DeploymentStatus.FAILED,
  DeploymentStatus.CANCELED,
  DeploymentStatus.ARCHIVED,
];

/** Statuses that count against an organisation's concurrent build budget. */
export const IN_FLIGHT_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.QUEUED,
  DeploymentStatus.BUILDING,
  DeploymentStatus.DEPLOYING,
];

export const ProjectType = {
  STATIC: 'static',
  WEB_SERVICE: 'web_service',
  WORKER: 'worker',
  CRON: 'cron',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];
export const PROJECT_TYPES: readonly ProjectType[] = ['static', 'web_service', 'worker', 'cron'];

/** Project types that run in a container and therefore need an image + runner. */
export const CONTAINER_PROJECT_TYPES: readonly ProjectType[] = ['web_service', 'worker', 'cron'];

/** Where a project's code comes from: built from a Git repository, or a prebuilt Docker image pulled from a registry. */
export const ProjectSource = {
  GIT: 'git',
  IMAGE: 'image',
} as const;
export type ProjectSource = (typeof ProjectSource)[keyof typeof ProjectSource];

export const DeploymentEnvironment = {
  PRODUCTION: 'production',
  PREVIEW: 'preview',
} as const;
export type DeploymentEnvironment = (typeof DeploymentEnvironment)[keyof typeof DeploymentEnvironment];

export const DeploymentTrigger = {
  MANUAL: 'manual',
  GIT_PUSH: 'git_push',
  REDEPLOY: 'redeploy',
  ROLLBACK: 'rollback',
  API: 'api',
} as const;
export type DeploymentTrigger = (typeof DeploymentTrigger)[keyof typeof DeploymentTrigger];

export const InstanceStatus = {
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  UNHEALTHY: 'UNHEALTHY',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
  LOST: 'LOST',
} as const;
export type InstanceStatus = (typeof InstanceStatus)[keyof typeof InstanceStatus];

export const DomainStatus = {
  /** Added, ownership not yet proven. */
  PENDING: 'pending',
  /** Ownership proven (TXT record) but the routing record is not pointing at Orb yet. */
  VERIFIED: 'verified',
  /** Ownership proven and DNS routes to Orb: serving traffic with TLS. */
  ACTIVE: 'active',
  ERROR: 'error',
} as const;
export type DomainStatus = (typeof DomainStatus)[keyof typeof DomainStatus];

export const Role = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

export const EnvTarget = {
  ALL: 'all',
  PRODUCTION: 'production',
  PREVIEW: 'preview',
} as const;
export type EnvTarget = (typeof EnvTarget)[keyof typeof EnvTarget];

export const EnvScope = {
  BOTH: 'both',
  BUILD: 'build',
  RUNTIME: 'runtime',
} as const;
export type EnvScope = (typeof EnvScope)[keyof typeof EnvScope];

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------
export const QUEUES = {
  /** git clone -> docker build -> publish artifact / image */
  build: 'orb-builds',
  /** schedule + start container instances for a built deployment */
  release: 'orb-releases',
  /** repeatable platform housekeeping jobs */
  maintenance: 'orb-maintenance',
  /** per-node command queue consumed by the runner agent on that node */
  runner: (nodeId: string) => `orb-runner-${nodeId}`,
} as const;

// ---------------------------------------------------------------------------
// Redis keys / channels
// ---------------------------------------------------------------------------
export const REDIS_KEYS = {
  buildLogs: (deploymentId: string) => `orb:logs:build:${deploymentId}`,
  runtimeLogs: (deploymentId: string) => `orb:logs:runtime:${deploymentId}`,
  /** Heartbeat blob written by each runner node (TTL'd). */
  node: (nodeId: string) => `orb:node:${nodeId}`,
  nodes: 'orb:nodes',
  /** Pub/Sub channel: the edge proxies drop cached routes when they receive a message. */
  routeInvalidate: 'orb:routes:invalidate',
  /** Hash of counters for one project/hour bucket (written by the edge, flushed to Postgres). */
  metricsBucket: (projectId: string, bucketIso: string) => `orb:metrics:${projectId}:${bucketIso}`,
  metricsIndex: 'orb:metrics:index',
  rateLimit: (key: string) => `orb:rl:${key}`,
  /** Epoch ms of the last request the edge forwarded to a project (drives idle sleep). */
  lastSeen: (projectId: string) => `orb:lastseen:${projectId}`,
  /** Held while a sleeping project is being woken so a burst of requests starts it only once. */
  wakeLock: (projectId: string) => `orb:wake:${projectId}`,
} as const;

export const BUILD_LOG_TTL_SECONDS = 60 * 60 * 24 * 7;
export const RUNTIME_LOG_MAX_LINES = 5000;
export const NODE_HEARTBEAT_TTL_SECONDS = 20;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
/** Reserved single-label hostnames that can never be claimed by a project slug. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'api', 'app', 'admin', 'dashboard', 'console', 'mail', 'smtp', 'imap', 'ftp', 'ns', 'ns1', 'ns2',
  'cname', 'status', 'docs', 'blog', 'support', 'help', 'cdn', 'assets', 'static', 'orb', 'internal', 'proxy',
  'registry', 'git', 'login', 'auth', 'billing', 'root', 'staging', 'prod', 'production', 'localhost',
]);

/** DNS label of the hostname that always points at a project's current production deployment. */
export const DEFAULT_APP_PORT = 3000;
export const MAX_ENV_VARS_PER_PROJECT = 200;
export const MAX_ENV_VALUE_BYTES = 8 * 1024;
