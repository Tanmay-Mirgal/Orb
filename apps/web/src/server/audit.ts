import { auditLogs } from 'database';
import { db } from '@/lib/db';
import type { AuthContext } from './context';

export interface AuditEvent {
  orgId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

function actorType(actor: AuthContext | null): string {
  if (!actor) return 'system';
  if (actor.via === 'token') return 'token';
  if (actor.via === 'connector') return 'connector';
  return 'user';
}

/** Best-effort: an audit write failure must never fail the user's request. */
export async function audit(actor: AuthContext | null, event: AuditEvent): Promise<void> {
  try {
    const connector = actor?.via === 'connector' ? actor.connector : undefined;
    await db.insert(auditLogs).values({
      orgId: event.orgId,
      actorId: actor?.userId ?? null,
      actorType: actorType(actor),
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      ip: actor?.ip ?? null,
      // Calls made through the ecosystem connector carry who/what made them (never a payload).
      via: connector ? 'connector' : null,
      clientId: connector?.clientId ?? null,
      grantId: connector?.grantId ?? null,
      requestId: connector?.requestId ?? null,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'audit write failed', action: event.action, err: String(err) }));
  }
}
