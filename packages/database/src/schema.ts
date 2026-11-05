import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { DeploymentConfig, ExternalRef } from 'shared';

/** Postgres transaction id (64-bit). Used to read the connector event log in commit order. */
const xid8 = customType<{ data: string }>({
  dataType() {
    return 'xid8';
  },
});

// ---------------------------------------------------------------------------
// Authentication (Better Auth). Table/column names are dictated by the library.
// ---------------------------------------------------------------------------
export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull(),
});

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => users.id),
});

export const accounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => users.id),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { mode: 'date' }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { mode: 'date' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt', { mode: 'date' }),
  updatedAt: timestamp('updatedAt', { mode: 'date' }),
});

export const verifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  createdAt: timestamp('createdAt', { mode: 'date' }),
  updatedAt: timestamp('updatedAt', { mode: 'date' }),
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  plan: varchar('plan', { length: 32 }).notNull().default('free'),
  /** When a paid/granted plan lapses and the team falls back to Hobby. Null for the free plan. */
  planExpiresAt: timestamp('plan_expires_at'),
  /** free | paid (Razorpay) | grant (complimentary, see plan_grants) */
  planSource: varchar('plan_source', { length: 16 }).notNull().default('free'),
  isPersonal: boolean('is_personal').notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull().default('member'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    /** SHA-256 of the token; the token itself is shown once at creation. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorId: text('actor_id'),
    actorType: varchar('actor_type', { length: 16 }).notNull().default('user'),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 255 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 64 }),
    /** `connector` for calls made through the ecosystem connector; null for the dashboard / API tokens. */
    via: varchar('via', { length: 16 }),
    clientId: varchar('client_id', { length: 128 }),
    grantId: uuid('grant_id'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('audit_logs_org_created_idx').on(t.orgId, t.createdAt), index('audit_logs_grant_idx').on(t.grantId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Team invitations, billing and notifications
// ---------------------------------------------------------------------------
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 254 }).notNull(),
    role: varchar('role', { length: 16 }).notNull().default('member'),
    /** SHA-256 of the token in the invitation link; the token itself only ever exists in the e-mail. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('invitations_org_idx').on(t.orgId), index('invitations_email_idx').on(t.email)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    plan: varchar('plan', { length: 32 }).notNull(),
    /** monthly | yearly */
    billingInterval: varchar('billing_interval', { length: 16 }).notNull(),
    /** Smallest currency unit (paise). */
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 8 }).notNull().default('INR'),
    razorpayOrderId: varchar('razorpay_order_id', { length: 64 }).notNull().unique(),
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 64 }).unique(),
    /** created | paid | failed */
    status: varchar('status', { length: 16 }).notNull().default('created'),
    method: varchar('method', { length: 32 }),
    periodStart: timestamp('period_start'),
    periodEnd: timestamp('period_end'),
    failureReason: text('failure_reason'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('payments_org_created_idx').on(t.orgId, t.createdAt)],
);

/** Complimentary plans by e-mail. Applied to the teams a (verified) user owns when they sign in or create a team. */
export const planGrants = pgTable('plan_grants', {
  email: varchar('email', { length: 254 }).primaryKey(),
  plan: varchar('plan', { length: 32 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 24 }).notNull(),
    type: varchar('type', { length: 48 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    href: varchar('href', { length: 512 }),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)],
);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** `{ [category]: { email: boolean } }`, see shared/notifications. */
  categories: jsonb('categories').$type<Record<string, { email: boolean }>>().notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Projects & deployments
// ---------------------------------------------------------------------------
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).unique(),
    /** Creator. Ownership/permissions are decided by `orgId` + memberships. */
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** static | web_service | worker | cron */
    type: varchar('type', { length: 32 }).notNull().default('static'),
    /** git (clone + build a repository) | image (pull a prebuilt Docker image) */
    sourceType: varchar('source_type', { length: 16 }).notNull().default('git'),
    /** Image reference for `image` projects, e.g. `ghcr.io/acme/api:1.4`. */
    dockerImage: varchar('docker_image', { length: 255 }),
    framework: varchar('framework', { length: 255 }),
    buildCommand: varchar('build_command', { length: 255 }),
    outputDirectory: varchar('output_directory', { length: 255 }),
    rootDirectory: varchar('root_directory', { length: 255 }),
    installCommand: varchar('install_command', { length: 255 }),
    startCommand: varchar('start_command', { length: 255 }),
    dockerfilePath: varchar('dockerfile_path', { length: 255 }),
    port: integer('port').notNull().default(3000),
    healthCheckPath: varchar('health_check_path', { length: 255 }).notNull().default('/'),
    instancePlan: varchar('instance_plan', { length: 32 }).notNull().default('free'),
    instanceCount: integer('instance_count').notNull().default(1),
    cronSchedule: varchar('cron_schedule', { length: 100 }),
    autoDeploy: boolean('auto_deploy').notNull().default(true),
    previewDeployments: boolean('preview_deployments').notNull().default(false),
    /** Set while an idle free-plan web service is stopped; the next request wakes it up. */
    sleepingAt: timestamp('sleeping_at'),
    /** Deployment that `<slug>.<base-domain>` and the project's custom domains currently serve. */
    currentDeploymentId: uuid('current_deployment_id').references((): AnyPgColumn => deployments.id, {
      onDelete: 'set null',
    }),
    /** Caller-defined data stored by the ecosystem connector (≤ 2 KB). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** Hub correlation ids, echoed in every connector event about this project and its deployments. */
    externalRef: jsonb('external_ref').$type<ExternalRef>(),
    /** `connector` when created through the ecosystem connector. */
    createdVia: varchar('created_via', { length: 16 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('projects_org_idx').on(t.orgId)],
);

export const projectRepositories = pgTable('project_repositories', {
  projectId: uuid('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' })
    .primaryKey(),
  githubRepositoryId: integer('github_repository_id').notNull(),
  githubRepositoryName: varchar('github_repository_name', { length: 255 }).notNull(),
  /** Production branch. */
  branch: varchar('branch', { length: 255 }).default('main').notNull(),
  /** GitHub App installation used to clone private repositories (falls back to the owner's OAuth token). */
  installationId: bigint('installation_id', { mode: 'number' }),
});

/**
 * Login for the private registry an `image` project pulls from. Kept out of `projects` on purpose: project rows are
 * returned by the API and serialized into pages, so a secret column there would leak with every `select()`.
 */
export const projectRegistryCredentials = pgTable('project_registry_credentials', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /**
   * Registry host the login belongs to (`ghcr.io`, `docker.io`, ...). It is only ever presented to that host, so
   * pointing the project's image at another registry cannot make the worker hand the secret to it.
   */
  registry: varchar('registry', { length: 255 }).notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  /** AES-256-GCM envelope (see core/crypto), bound to the project id. */
  password: text('password').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('projectId')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** QUEUED | BUILDING | DEPLOYING | READY | FAILED | CANCELED */
    status: varchar('status', { length: 50 }).notNull().default('QUEUED'),
    environment: varchar('environment', { length: 16 }).notNull().default('production'),
    trigger: varchar('trigger', { length: 16 }).notNull().default('manual'),
    branch: varchar('branch', { length: 255 }),
    commitHash: varchar('commit_hash', { length: 255 }),
    commitMessage: text('commit_message'),
    commitAuthor: varchar('commit_author', { length: 255 }),
    /** Immutable URL label: `<slug>-<8 hex>.<base-domain>`. */
    subdomain: varchar('subdomain', { length: 100 }).unique(),
    config: jsonb('config').$type<DeploymentConfig>(),
    /** Container image (web services / workers / cron). */
    imageRef: varchar('image_ref', { length: 512 }),
    /** Static sites: number of files in the published artifact. */
    fileCount: integer('file_count'),
    errorMessage: text('error_message'),
    createdBy: text('created_by'),
    buildStartedAt: timestamp('build_started_at'),
    buildFinishedAt: timestamp('build_finished_at'),
    readyAt: timestamp('ready_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    externalRef: jsonb('external_ref').$type<ExternalRef>(),
    createdVia: varchar('created_via', { length: 16 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('deployments_project_created_idx').on(t.projectId, t.createdAt),
    index('deployments_status_idx').on(t.status),
  ],
);

/** Running container replicas of a deployment (web services / workers). */
export const instances = pgTable(
  'instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    nodeId: varchar('node_id', { length: 128 }).notNull(),
    containerId: varchar('container_id', { length: 128 }),
    /** Address:port the edge proxies use to reach this instance. */
    address: varchar('address', { length: 255 }),
    hostPort: integer('host_port'),
    /** STARTING | RUNNING | UNHEALTHY | STOPPED | FAILED | LOST */
    status: varchar('status', { length: 16 }).notNull().default('STARTING'),
    cpuMillis: integer('cpu_millis').notNull().default(0),
    memoryMb: integer('memory_mb').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    stoppedAt: timestamp('stopped_at'),
  },
  (t) => [
    index('instances_deployment_idx').on(t.deploymentId),
    index('instances_node_status_idx').on(t.nodeId, t.status),
    index('instances_project_idx').on(t.projectId),
  ],
);

// ---------------------------------------------------------------------------
// Domains & configuration
// ---------------------------------------------------------------------------
export const domains = pgTable(
  'domains',
  {
    domain: varchar('domain', { length: 255 }).notNull().primaryKey(),
    projectId: uuid('projectId')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** pending | verified | active | error */
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    verificationToken: varchar('verification_token', { length: 64 }),
    verifiedAt: timestamp('verified_at'),
    lastCheckedAt: timestamp('last_checked_at'),
    lastError: text('last_error'),
    /** When set, the edge answers 308 to this domain (e.g. www -> apex). */
    redirectTo: varchar('redirect_to', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('domains_project_idx').on(t.projectId), index('domains_status_idx').on(t.status)],
);

export const environmentVariables = pgTable(
  'environment_variables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('projectId')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 255 }).notNull(),
    /** AES-256-GCM envelope (see core/crypto). Legacy rows may still be plaintext until `db:encrypt-legacy`. */
    value: text('value').notNull(),
    /** all | production | preview */
    target: varchar('target', { length: 16 }).notNull().default('all'),
    /** both | build | runtime */
    scope: varchar('scope', { length: 16 }).notNull().default('both'),
    /** Secret values are never returned by the API after creation. */
    isSecret: boolean('is_secret').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('env_vars_project_key_target_idx').on(t.projectId, t.key, t.target)],
);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export const usageHourly = pgTable(
  'usage_hourly',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    bucket: timestamp('bucket').notNull(),
    requests: bigint('requests', { mode: 'number' }).notNull().default(0),
    bytesOut: bigint('bytes_out', { mode: 'number' }).notNull().default(0),
    status2xx: bigint('status_2xx', { mode: 'number' }).notNull().default(0),
    status3xx: bigint('status_3xx', { mode: 'number' }).notNull().default(0),
    status4xx: bigint('status_4xx', { mode: 'number' }).notNull().default(0),
    status5xx: bigint('status_5xx', { mode: 'number' }).notNull().default(0),
    durationMsTotal: bigint('duration_ms_total', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.bucket] })],
);

// ---------------------------------------------------------------------------
// Ecosystem connector (CP1). Everything below is unused unless CONNECTOR_ENABLED=true.
// ---------------------------------------------------------------------------

/** One user's consent for one team: the token family. Tokens are stored as HMAC-SHA256(pepper, token) only. */
export const connectorGrants = pgTable(
  'connector_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    accessHash: varchar('access_hash', { length: 64 }).notNull(),
    accessExpiresAt: timestamp('access_expires_at').notNull(),
    refreshHash: varchar('refresh_hash', { length: 64 }).notNull(),
    refreshFamilyId: uuid('refresh_family_id').defaultRandom().notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
    /** user | admin | client | reuse_detected | code_reuse | membership_lost */
    revokeReason: varchar('revoke_reason', { length: 32 }),
  },
  (t) => [
    uniqueIndex('connector_grants_access_hash_idx').on(t.accessHash),
    uniqueIndex('connector_grants_refresh_hash_idx').on(t.refreshHash),
    index('connector_grants_user_idx').on(t.userId),
    index('connector_grants_org_idx').on(t.orgId),
  ],
);

/** Refresh tokens that were already rotated: presenting one again means the token family was stolen. */
export const connectorUsedRefresh = pgTable(
  'connector_used_refresh',
  {
    refreshHash: varchar('refresh_hash', { length: 64 }).primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => connectorGrants.id, { onDelete: 'cascade' }),
    usedAt: timestamp('used_at').defaultNow().notNull(),
  },
  (t) => [index('connector_used_refresh_grant_idx').on(t.grantId)],
);

/** Single-use authorization codes (60 s). The code itself is only stored hashed. */
export const connectorCodes = pgTable(
  'connector_codes',
  {
    codeHash: varchar('code_hash', { length: 64 }).primaryKey(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    /** Set when the code is exchanged: a second use revokes this grant. */
    grantId: uuid('grant_id').references(() => connectorGrants.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('connector_codes_expires_idx').on(t.expiresAt)],
);

export const connectorWebhooks = pgTable(
  'connector_webhooks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => connectorGrants.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Exact event types and `prefix.*` patterns. */
    eventFilter: text('event_filter').array().notNull(),
    description: varchar('description', { length: 255 }),
    /** AES-256-GCM envelope (CONNECTOR_ENCRYPTION_KEY), bound to the webhook id. */
    secretEnc: text('secret_enc').notNull(),
    /** active | disabled */
    status: varchar('status', { length: 16 }).notNull().default('active'),
    disabledReason: varchar('disabled_reason', { length: 64 }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Start of the current run of failures (disables the endpoint after 3 days). */
    failingSince: timestamp('failing_since'),
    lastDeliveryAt: timestamp('last_delivery_at'),
    lastDeliveryStatus: varchar('last_delivery_status', { length: 16 }),
    lastResponseCode: integer('last_response_code'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('connector_webhooks_grant_idx').on(t.grantId), index('connector_webhooks_org_status_idx').on(t.orgId, t.status)],
);

/** Transactional outbox AND the tenant's event log (`GET /events`). Written in the same transaction as the change. */
export const connectorEvents = pgTable(
  'connector_events',
  {
    /** `evt_<ULID>` */
    id: text('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    occurredAt: timestamp('occurred_at').notNull(),
    /** The complete envelope that is sent to webhooks and returned by the event log. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    externalRef: jsonb('external_ref').$type<ExternalRef>(),
    /** Monotonic position; the polling cursor is (tx_id, seq) so readers never skip a late-committing row. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    txId: xid8('tx_id').notNull().default(sql`pg_current_xact_id()`),
    /** Null until the dispatcher has fanned the event out to the matching webhook endpoints. */
    dispatchedAt: timestamp('dispatched_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('connector_events_seq_idx').on(t.seq),
    index('connector_events_org_order_idx').on(t.orgId, t.txId, t.seq),
    index('connector_events_pending_idx').on(t.seq).where(sql`dispatched_at IS NULL`),
    index('connector_events_created_idx').on(t.createdAt),
  ],
);

export const connectorDeliveries = pgTable(
  'connector_deliveries',
  {
    /** Sent as `X-CP-Delivery`; stable across retries. */
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => connectorEvents.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => connectorWebhooks.id, { onDelete: 'cascade' }),
    /** Attempts made so far. */
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at'),
    /** pending | delivering | succeeded | failed (will retry) | abandoned */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    responseCode: integer('response_code'),
    responseExcerpt: text('response_excerpt'),
    lastError: varchar('last_error', { length: 255 }),
    /** Lease while a worker is delivering, so a crashed worker's delivery is picked up again. */
    lockedUntil: timestamp('locked_until'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at'),
  },
  (t) => [
    uniqueIndex('connector_deliveries_event_webhook_idx').on(t.eventId, t.webhookId),
    index('connector_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('connector_deliveries_webhook_idx').on(t.webhookId, t.createdAt),
  ],
);

export const connectorOperations = pgTable(
  'connector_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => connectorGrants.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 64 }).notNull(),
    /** pending | running | succeeded | failed | canceled */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    deadlineAt: timestamp('deadline_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (t) => [index('connector_operations_grant_idx').on(t.grantId, t.createdAt), index('connector_operations_open_idx').on(t.status)],
);

export const connectorIdempotency = pgTable(
  'connector_idempotency',
  {
    grantId: uuid('grant_id')
      .notNull()
      .references(() => connectorGrants.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 128 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    /** processing | done */
    state: varchar('state', { length: 12 }).notNull().default('processing'),
    status: integer('status'),
    response: jsonb('response').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.grantId, t.key] }), index('connector_idempotency_expires_idx').on(t.expiresAt)],
);

export type User = typeof users.$inferSelect;
export type ConnectorGrant = typeof connectorGrants.$inferSelect;
export type ConnectorCode = typeof connectorCodes.$inferSelect;
export type ConnectorWebhook = typeof connectorWebhooks.$inferSelect;
export type ConnectorEvent = typeof connectorEvents.$inferSelect;
export type ConnectorDelivery = typeof connectorDeliveries.$inferSelect;
export type ConnectorOperation = typeof connectorOperations.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectRepository = typeof projectRepositories.$inferSelect;
export type ProjectRegistryCredentials = typeof projectRegistryCredentials.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type Instance = typeof instances.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type EnvironmentVariable = typeof environmentVariables.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PlanGrant = typeof planGrants.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
