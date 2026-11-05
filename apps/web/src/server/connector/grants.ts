import { and, connectorGrants, connectorWebhooks, eq, isNull } from 'database';
import { db } from '@/lib/db';

export type RevokeReason = 'user' | 'admin' | 'client' | 'reuse_detected' | 'code_reuse' | 'membership_lost';

export interface RevokedGrant {
  id: string;
  orgId: string;
  userId: string;
  clientId: string;
}

type Executor = Pick<typeof db, 'update' | 'delete'>;

/**
 * Revokes a grant: its access and refresh tokens stop working immediately (every request looks the grant up) and the
 * webhook endpoints it created are removed (their pending deliveries go with them). Idempotent.
 */
export async function revokeGrantWith(executor: Executor, grantId: string, reason: RevokeReason): Promise<RevokedGrant | null> {
  const [row] = await executor
    .update(connectorGrants)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(connectorGrants.id, grantId), isNull(connectorGrants.revokedAt)))
    .returning({ id: connectorGrants.id, orgId: connectorGrants.orgId, userId: connectorGrants.userId, clientId: connectorGrants.clientId });
  if (!row) return null;
  await executor.delete(connectorWebhooks).where(eq(connectorWebhooks.grantId, grantId));
  return row;
}

export function revokeGrant(grantId: string, reason: RevokeReason): Promise<RevokedGrant | null> {
  return db.transaction((tx) => revokeGrantWith(tx, grantId, reason));
}
