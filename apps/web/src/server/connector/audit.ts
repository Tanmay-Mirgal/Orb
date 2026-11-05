import { auditLogs } from 'database';
import { db } from '@/lib/db';
import type { ConnectorAuth } from './auth';
import { audit, type AuditEvent } from '../audit';

/** Grant lifecycle events (consent, token exchange, revocation) that happen outside an authenticated connector call. */
export async function auditConnectorLifecycle(event: {
  orgId: string;
  userId: string | null;
  action: string;
  grantId?: string;
  clientId?: string;
  requestId?: string;
  ip?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      orgId: event.orgId,
      actorId: event.userId,
      actorType: 'connector',
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      ip: event.ip ?? null,
      via: 'connector',
      clientId: event.clientId ?? null,
      grantId: event.grantId ?? null,
      requestId: event.requestId ?? null,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'connector audit write failed', action: event.action, err: String(err) }));
  }
}

/** Audit row for a call made through the connector: who (client + grant), what (action) and which request. No payloads. */
export function auditConnectorCall(auth: ConnectorAuth, connectorAction: string, event: AuditEvent): Promise<void> {
  return audit(auth, { ...event, metadata: { ...event.metadata, connectorAction } });
}
