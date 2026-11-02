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

/** Best-effort: an audit write failure must never fail the user's request. */
export async function audit(actor: AuthContext | null, event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      orgId: event.orgId,
      actorId: actor?.userId ?? null,
      actorType: actor ? (actor.via === 'token' ? 'token' : 'user') : 'system',
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
      ip: actor?.ip ?? null,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'audit write failed', action: event.action, err: String(err) }));
  }
}
