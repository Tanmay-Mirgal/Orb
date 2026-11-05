import {
  and,
  auditLogs,
  connectorGrants,
  connectorWebhooks,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  memberships,
  or,
  organizations,
  users,
} from 'database';
import { db } from '@/lib/db';

/** What the dashboard shows under Settings → Connected apps. Never contains tokens, hashes or webhook secrets. */

const PRIVILEGED = ['owner', 'admin'];

/** A webhook URL can carry a secret in its path or query (Slack-style): only the origin is shown. */
function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname.length > 1 || u.search ? '/…' : ''}`;
  } catch {
    return 'invalid URL';
  }
}

export async function listConnectedApps(userId: string) {
  const mine = await db.select({ orgId: memberships.orgId, role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
  const adminOrgIds = mine.filter((m) => PRIVILEGED.includes(m.role)).map((m) => m.orgId);
  if (mine.length === 0) return { grants: [], activity: [] };

  const rows = await db
    .select({ grant: connectorGrants, org: organizations, user: users })
    .from(connectorGrants)
    .innerJoin(organizations, eq(organizations.id, connectorGrants.orgId))
    .innerJoin(users, eq(users.id, connectorGrants.userId))
    .where(
      and(
        isNull(connectorGrants.revokedAt),
        gt(connectorGrants.refreshExpiresAt, new Date()),
        adminOrgIds.length ? or(eq(connectorGrants.userId, userId), inArray(connectorGrants.orgId, adminOrgIds)) : eq(connectorGrants.userId, userId),
      ),
    )
    .orderBy(desc(connectorGrants.createdAt))
    .limit(100);
  if (rows.length === 0) return { grants: [], activity: [] };

  const grantIds = rows.map((r) => r.grant.id);
  const [hooks, activity] = await Promise.all([
    db.select().from(connectorWebhooks).where(inArray(connectorWebhooks.grantId, grantIds)),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        metadata: auditLogs.metadata,
        grantId: auditLogs.grantId,
        requestId: auditLogs.requestId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(inArray(auditLogs.grantId, grantIds))
      .orderBy(desc(auditLogs.createdAt))
      .limit(20),
  ]);

  const grants = rows.map(({ grant, org, user }) => ({
    id: grant.id,
    clientId: grant.clientId,
    org: { id: org.id, name: org.name },
    scopes: grant.scopes,
    connectedBy: { id: user.id, name: user.name, email: user.email },
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt,
    expiresAt: grant.refreshExpiresAt,
    canRevoke: grant.userId === userId || adminOrgIds.includes(grant.orgId),
    webhooks: hooks
      .filter((h) => h.grantId === grant.id)
      .map((h) => ({
        id: h.id,
        url: displayUrl(h.url),
        status: h.status,
        disabledReason: h.disabledReason,
        consecutiveFailures: h.consecutiveFailures,
        lastDeliveryAt: h.lastDeliveryAt,
        lastDeliveryStatus: h.lastDeliveryStatus,
        lastResponseCode: h.lastResponseCode,
      })),
  }));

  const orgByGrant = new Map(rows.map((r) => [r.grant.id, r.org.name]));
  return {
    grants,
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      connectorAction: typeof a.metadata?.connectorAction === 'string' ? a.metadata.connectorAction : null,
      target: a.targetType ? `${a.targetType}${a.targetId ? ` ${String(a.targetId).slice(0, 8)}` : ''}` : null,
      org: a.grantId ? (orgByGrant.get(a.grantId) ?? null) : null,
      requestId: a.requestId,
      createdAt: a.createdAt,
    })),
  };
}

/** The grant when `userId` may revoke it: its owner, or an admin/owner of its team. */
export async function findRevocableGrant(userId: string, grantId: string) {
  const [row] = await db
    .select({ grant: connectorGrants, role: memberships.role })
    .from(connectorGrants)
    .leftJoin(memberships, and(eq(memberships.orgId, connectorGrants.orgId), eq(memberships.userId, userId)))
    .where(and(eq(connectorGrants.id, grantId), isNull(connectorGrants.revokedAt)))
    .limit(1);
  if (!row) return null;
  const isOwner = row.grant.userId === userId;
  const isAdmin = row.role !== null && PRIVILEGED.includes(row.role);
  if (!isOwner && !isAdmin) return null;
  return { grant: row.grant, by: isOwner ? ('user' as const) : ('admin' as const) };
}
