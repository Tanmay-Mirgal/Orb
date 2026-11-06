import { connectorEnabled, deploymentUrl, newEventId } from 'core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Actor, ActorKind, DeploymentEventData, EventProjectRef, ExternalRef } from 'shared';
import type { Database } from './client';
import { toProjectEntity, triggeredBy, deploymentWebUrl } from './connector-entities';
import {
  connectorEvents,
  connectorGrants,
  deployments,
  projectRepositories,
  projects,
  users,
  type Deployment,
  type Domain,
  type Project,
  type ProjectRepository,
} from './schema';

/**
 * Transactional outbox of the ecosystem connector. `emitConnectorEvent` must be called with the SAME transaction
 * that makes the change, so an event exists if and only if the change committed; a worker fans it out to webhook
 * endpoints afterwards and `GET /events` serves the same rows. With `CONNECTOR_ENABLED` off nothing here runs a query.
 */

/** The database or a transaction of it. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/**
 * Runs `fn` in a transaction only when the connector is on, so a deployment without it executes exactly the
 * statements it did before the connector existed (no BEGIN/COMMIT, no extra queries).
 */
export function withOutbox<T>(db: Database, fn: (tx: Executor) => Promise<T>): Promise<T> {
  if (!connectorEnabled()) return fn(db);
  return db.transaction((tx) => fn(tx as unknown as Executor));
}

export interface ActorSpec {
  kind: ActorKind;
  userId?: string | null;
}

export const SYSTEM_ACTOR: ActorSpec = { kind: 'system' };

async function resolveActor(tx: Executor, spec: ActorSpec): Promise<Actor> {
  if (!spec.userId) return { id: null, name: null, kind: spec.kind };
  const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, spec.userId)).limit(1);
  return { id: spec.userId, name: row?.name ?? null, kind: spec.kind };
}

/** Somebody is able to receive events of this team: at least one live grant. */
async function hasListeners(tx: Executor, orgId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: connectorGrants.id })
    .from(connectorGrants)
    .where(and(eq(connectorGrants.orgId, orgId), isNull(connectorGrants.revokedAt), gt(connectorGrants.refreshExpiresAt, new Date())))
    .limit(1);
  return Boolean(row);
}

export interface EmitInput {
  orgId: string;
  type: string;
  data: Record<string, unknown>;
  externalRef?: ExternalRef | null;
  actor: ActorSpec;
  occurredAt?: Date;
}

/** Writes one event. Returns its id, or null when the connector is off or nobody could receive it. */
export async function emitConnectorEvent(tx: Executor, input: EmitInput): Promise<string | null> {
  if (!connectorEnabled()) return null;
  if (!(await hasListeners(tx, input.orgId))) return null;
  const id = newEventId();
  const occurredAt = input.occurredAt ?? new Date();
  const externalRef = input.externalRef && Object.keys(input.externalRef).length > 0 ? input.externalRef : null;
  const envelope = {
    id,
    type: input.type,
    apiVersion: 'cp1',
    service: 'orb',
    occurredAt: occurredAt.toISOString(),
    tenantId: input.orgId,
    actor: await resolveActor(tx, input.actor),
    externalRef: externalRef ?? {},
    data: input.data,
  };
  await tx.insert(connectorEvents).values({ id, orgId: input.orgId, type: input.type, occurredAt, payload: envelope, externalRef });
  return id;
}

// --- payload builders -------------------------------------------------------------------------------------------------

export function projectRef(project: Pick<Project, 'id' | 'name' | 'slug' | 'type'>): EventProjectRef {
  return { id: project.id, name: project.name, slug: project.slug, type: project.type, url: project.slug ? deploymentUrl(project.slug) : null };
}

export function deploymentEventData(deployment: Deployment, project: Project): DeploymentEventData {
  const started = deployment.buildStartedAt;
  const finished = deployment.buildFinishedAt;
  return {
    project: projectRef(project),
    deployment: {
      id: deployment.id,
      environment: deployment.environment === 'preview' ? 'preview' : 'production',
      branch: deployment.branch,
      commitSha: deployment.commitHash,
      commitMessage: deployment.commitMessage,
      status: deployment.status,
      url: deployment.subdomain ? deploymentUrl(deployment.subdomain) : null,
      triggeredBy: triggeredBy(deployment.trigger),
      ...(started && finished ? { buildDurationMs: Math.max(0, finished.getTime() - started.getTime()) } : {}),
      ...(deployment.errorMessage ? { errorMessage: deployment.errorMessage } : {}),
    },
    webUrl: deploymentWebUrl(project, deployment.id),
  };
}

/** A deployment inherits the correlation ids of its project; its own win. */
export function mergedRef(project: Pick<Project, 'externalRef'>, deployment?: Pick<Deployment, 'externalRef'>): ExternalRef | null {
  const merged = { ...project.externalRef, ...deployment?.externalRef };
  return Object.keys(merged).length > 0 ? merged : null;
}

export type DeploymentEventType = 'queued' | 'building' | 'deploying' | 'ready' | 'failed' | 'canceled' | 'promoted';

/**
 * `deployment.<type>` read back inside the caller's transaction, so the payload shows exactly the state that was
 * just written. Call it once per real transition (only when a conditional UPDATE changed a row).
 */
export async function emitDeploymentEvent(
  tx: Executor,
  deploymentId: string,
  type: DeploymentEventType,
  actor: ActorSpec = SYSTEM_ACTOR,
  extra: { previousDeploymentId?: string | null } = {},
): Promise<void> {
  if (!connectorEnabled()) return;
  const [row] = await tx
    .select({ deployment: deployments, project: projects })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!row) return;
  await emitConnectorEvent(tx, {
    orgId: row.project.orgId,
    type: `deployment.${type}`,
    data: { ...deploymentEventData(row.deployment, row.project), ...(type === 'promoted' ? { previousDeploymentId: extra.previousDeploymentId ?? null } : {}) },
    externalRef: mergedRef(row.project, row.deployment),
    actor,
  });
}

export async function emitProjectEvent(
  tx: Executor,
  project: Project,
  repository: ProjectRepository | null,
  type: 'created' | 'updated' | 'deleted',
  actor: ActorSpec,
): Promise<void> {
  if (!connectorEnabled()) return;
  await emitConnectorEvent(tx, { orgId: project.orgId, type: `project.${type}`, data: { project: toProjectEntity(project, repository) }, externalRef: project.externalRef, actor });
}

/** `project.updated` for a project that is only known by id (re-reads project and repository in the transaction). */
export async function emitProjectEventById(tx: Executor, projectId: string, type: 'updated', actor: ActorSpec): Promise<void> {
  if (!connectorEnabled()) return;
  const [row] = await tx
    .select({ project: projects, repository: projectRepositories })
    .from(projects)
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (row) await emitProjectEvent(tx, row.project, row.repository, type, actor);
}

export async function emitDomainEvent(
  tx: Executor,
  domain: Pick<Domain, 'domain' | 'status' | 'lastError' | 'redirectTo' | 'projectId'>,
  type: 'added' | 'verified' | 'verification_failed',
  actor: ActorSpec = SYSTEM_ACTOR,
): Promise<void> {
  if (!connectorEnabled()) return;
  const [project] = await tx.select().from(projects).where(eq(projects.id, domain.projectId)).limit(1);
  if (!project) return;
  await emitConnectorEvent(tx, {
    orgId: project.orgId,
    type: `domain.${type}`,
    data: {
      project: projectRef(project),
      domain: { domain: domain.domain, status: domain.status, lastError: domain.lastError, redirectTo: domain.redirectTo },
    },
    externalRef: project.externalRef,
    actor,
  });
}

/** Keys only, never values. One event per request however many variables it touched. */
export async function emitEnvEvent(
  tx: Executor,
  projectId: string,
  keys: string[],
  target: 'all' | 'production' | 'preview',
  action: 'set' | 'removed',
  actor: ActorSpec,
): Promise<void> {
  if (!connectorEnabled() || keys.length === 0) return;
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return;
  await emitConnectorEvent(tx, {
    orgId: project.orgId,
    type: 'env.updated',
    data: { project: projectRef(project), keys: [...new Set(keys)].sort(), target, action },
    externalRef: project.externalRef,
    actor,
  });
}

export async function emitServiceEvent(
  tx: Executor,
  projectId: string,
  type: 'unhealthy' | 'recovered',
  instances: { desired: number; running: number; unhealthy: number; lost: number },
): Promise<void> {
  if (!connectorEnabled()) return;
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return;
  await emitConnectorEvent(tx, { orgId: project.orgId, type: `service.${type}`, data: { project: projectRef(project), instances }, externalRef: project.externalRef, actor: SYSTEM_ACTOR });
}

export async function emitPlanLimitEvent(db: Database, orgId: string, info: { limit: number | null; kind: string }, actor: ActorSpec): Promise<void> {
  if (!connectorEnabled()) return;
  await emitConnectorEvent(db, { orgId, type: 'plan.limit_reached', data: { limit: info.limit, kind: info.kind }, actor });
}
