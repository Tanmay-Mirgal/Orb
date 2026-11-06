import { and, connectorOperations, eq, gt, inArray, toDeploymentEntity, type ConnectorOperation } from 'database';
import { TERMINAL_DEPLOYMENT_STATUSES, cpNotFound, type DeploymentStatus } from 'shared';
import { db } from '@/lib/db';
import type { ConnectorAuth } from './auth';
import { pinnedDeployment } from './data';

/**
 * Long-running actions return `202` and an operation owned by the grant. Operations are retained for 7 days and are
 * resolved lazily when polled (and swept by the worker's retention job), so no process has to stay alive for them.
 */

export const OPERATION_RETENTION_MS = 7 * 24 * 3_600_000;

export interface OperationView {
  id: string;
  action: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  createdAt: string;
  finishedAt?: string;
}

export function operationView(op: ConnectorOperation): OperationView {
  return {
    id: op.id,
    action: op.action,
    status: op.status as OperationView['status'],
    ...(op.output ? { output: op.output } : {}),
    ...(op.error ? { error: op.error } : {}),
    createdAt: op.createdAt.toISOString(),
    ...(op.finishedAt ? { finishedAt: op.finishedAt.toISOString() } : {}),
  };
}

export const pollUrl = (id: string) => `/api/connect/v1/operations/${id}`;

export async function createOperation(auth: ConnectorAuth, action: string, input: Record<string, unknown>, deadlineAt: Date | null): Promise<ConnectorOperation> {
  const [op] = await db
    .insert(connectorOperations)
    .values({ grantId: auth.connector.grantId, orgId: auth.org.id, action, input, deadlineAt, status: 'pending' })
    .returning();
  return op!;
}

/** Only the grant that started an operation can see it. Anything else is a 404. */
export async function loadOperation(auth: ConnectorAuth, id: string): Promise<ConnectorOperation> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw cpNotFound('Operation');
  const [op] = await db
    .select()
    .from(connectorOperations)
    .where(
      and(
        eq(connectorOperations.id, id),
        eq(connectorOperations.grantId, auth.connector.grantId),
        gt(connectorOperations.createdAt, new Date(Date.now() - OPERATION_RETENTION_MS)),
      ),
    )
    .limit(1);
  if (!op) throw cpNotFound('Operation');
  return op;
}

const OPEN = ['pending', 'running'];

async function settle(op: ConnectorOperation, patch: { status: 'running' | 'succeeded' | 'failed'; output?: Record<string, unknown>; error?: Record<string, unknown> }): Promise<ConnectorOperation> {
  const terminal = patch.status !== 'running';
  const now = new Date();
  // Conditional: a concurrent poll may have settled it already.
  const [updated] = await db
    .update(connectorOperations)
    .set({ status: patch.status, output: patch.output ?? null, error: patch.error ?? null, updatedAt: now, finishedAt: terminal ? now : null })
    .where(and(eq(connectorOperations.id, op.id), inArray(connectorOperations.status, OPEN)))
    .returning();
  if (updated) return updated;
  const [current] = await db.select().from(connectorOperations).where(eq(connectorOperations.id, op.id)).limit(1);
  return current ?? op;
}

/** Moves an open operation forward by looking at the world. Idempotent and cheap (one indexed read). */
export async function advanceOperation(auth: ConnectorAuth, op: ConnectorOperation): Promise<ConnectorOperation> {
  if (!OPEN.includes(op.status)) return op;
  if (op.action === 'projects.waitForDeployment') {
    const deploymentId = String(op.input.deploymentId ?? '');
    let found;
    try {
      found = await pinnedDeployment(auth, deploymentId);
    } catch {
      return settle(op, { status: 'failed', error: { code: 'not_found', message: 'The deployment no longer exists' } });
    }
    if (TERMINAL_DEPLOYMENT_STATUSES.includes(found.deployment.status as DeploymentStatus)) {
      return settle(op, { status: 'succeeded', output: { deployment: toDeploymentEntity(found.deployment, found.project) } });
    }
    if (op.deadlineAt && op.deadlineAt.getTime() <= Date.now()) {
      return settle(op, { status: 'failed', error: { code: 'timeout', message: 'The deployment did not finish in time. It is still running; poll it or wait again.' } });
    }
    if (op.status === 'pending') return settle(op, { status: 'running' });
  }
  return op;
}
