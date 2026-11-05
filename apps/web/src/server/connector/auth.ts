import {
  and,
  connectorGrants,
  eq,
  isNull,
  lt,
  memberships,
  or,
  organizations,
  users,
  type Organization,
} from 'database';
import { connectorTokenKind, hashConnectorToken, rateLimit, safeEqual } from 'core';
import {
  CONNECTOR_LIMITS,
  cpForbidden,
  cpInsufficientScope,
  cpRateLimited,
  cpUnauthorized,
  effectiveScopes,
  getOrgPlan,
  can,
  type ConnectorScope,
  type Permission,
  type Role,
} from 'shared';
import { db } from '@/lib/db';
import { clientIp, enforceRateLimit } from '../api';
import type { AuthContext } from '../context';
import { getRedis } from '../infra';
import { revokeGrant } from './grants';
import { connectRoute, type ConnectContext } from './http';

/**
 * The authenticated caller of a connector request: the user who consented, acting inside the one team the grant is
 * pinned to, with the scopes the grant holds capped by that user's CURRENT role in the team.
 */
export interface ConnectorAuth extends AuthContext {
  via: 'connector';
  connector: { grantId: string; clientId: string; requestId: string };
  org: Organization;
  role: Role;
  /** Effective scopes: granted scopes ∩ what the role allows right now. */
  scopes: ConnectorScope[];
  /** Scopes stored on the grant (before the role cap). */
  grantedScopes: string[];
}

const LAST_USED_INTERVAL_MS = 5 * 60_000;

/**
 * Verifies `Authorization: Bearer cp1_orb_…` and re-evaluates the user's membership on every request:
 * a revoked grant, an expired token, a removed member or a downgraded role takes effect on the very next call.
 */
export async function authenticateConnector(req: Request, requestId: string, responseHeaders: Record<string, string>): Promise<ConnectorAuth> {
  const ip = clientIp(req);
  await enforceRateLimit(`cp1ip:${ip ?? 'unknown'}`, 3000, 60);

  const header = req.headers.get('authorization');
  if (!header || !/^bearer\s+/i.test(header)) throw cpUnauthorized();
  const token = header.replace(/^bearer\s+/i, '').trim();
  if (connectorTokenKind(token) !== 'access') throw cpUnauthorized();

  const hash = hashConnectorToken(token);
  const [row] = await db
    .select({ grant: connectorGrants, user: users, org: organizations })
    .from(connectorGrants)
    .innerJoin(users, eq(users.id, connectorGrants.userId))
    .innerJoin(organizations, eq(organizations.id, connectorGrants.orgId))
    .where(eq(connectorGrants.accessHash, hash))
    .limit(1);
  const now = Date.now();
  if (!row || !safeEqual(row.grant.accessHash, hash) || row.grant.revokedAt || row.grant.accessExpiresAt.getTime() <= now) {
    throw cpUnauthorized();
  }
  const { grant, user, org } = row;

  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id)))
    .limit(1);
  if (!membership) {
    await revokeGrant(grant.id, 'membership_lost');
    throw cpUnauthorized('The user who connected this app is no longer a member of the team');
  }

  // A grant is pinned to one team: asking for another one is an error, not a way to switch.
  const requestedOrg = req.headers.get('x-orb-org') ?? new URL(req.url).searchParams.get('orgId');
  if (requestedOrg && requestedOrg !== org.id) throw cpForbidden('This connection is pinned to another team');

  const limit = CONNECTOR_LIMITS.requestsPerMinute;
  const rl = await rateLimit(getRedis(), `cp1:grant:${grant.id}`, limit, 60);
  responseHeaders['X-RateLimit-Limit'] = String(limit);
  responseHeaders['X-RateLimit-Remaining'] = String(rl.remaining);
  responseHeaders['X-RateLimit-Reset'] = String(Math.floor(now / 1000) + rl.resetSeconds);
  if (!rl.allowed) throw cpRateLimited(rl.resetSeconds);
  await enforceRateLimit(`org:${org.id}`, getOrgPlan(org.plan).apiRatePerMinute, 60);

  // At most one bookkeeping write per five minutes per grant, even with several web instances.
  if (!grant.lastUsedAt || now - grant.lastUsedAt.getTime() > LAST_USED_INTERVAL_MS) {
    void db
      .update(connectorGrants)
      .set({ lastUsedAt: new Date(now) })
      .where(and(eq(connectorGrants.id, grant.id), or(isNull(connectorGrants.lastUsedAt), lt(connectorGrants.lastUsedAt, new Date(now - LAST_USED_INTERVAL_MS)))))
      .catch(() => undefined);
  }

  const role = membership.role as Role;
  return {
    userId: user.id,
    userName: user.name,
    email: user.email,
    via: 'connector',
    ip,
    connector: { grantId: grant.id, clientId: grant.clientId, requestId },
    org,
    role,
    scopes: effectiveScopes(role, grant.scopes),
    grantedScopes: grant.scopes,
  };
}

export function hasScope(auth: ConnectorAuth, scope: ConnectorScope): boolean {
  return auth.scopes.includes(scope);
}

/** 403 `insufficient_scope` (with `requiredScope`) unless the grant holds the scope AND the user's role still allows it. */
export function requireScope(auth: ConnectorAuth, scope: ConnectorScope): void {
  if (!hasScope(auth, scope)) throw cpInsufficientScope(scope);
}

/** The same permission check the dashboard does (e.g. promoting a deployment needs the admin role). */
export function requirePermission(auth: ConnectorAuth, permission: Permission): void {
  if (!can(auth.role, permission)) throw cpForbidden();
}

export interface AuthedContext<P> extends ConnectContext<P> {
  auth: ConnectorAuth;
}

/** `connectRoute` + authentication + the scope(s) every caller of this route needs. */
export function connectAuthed<P extends Record<string, string> = Record<string, never>>(
  options: { scope?: ConnectorScope | readonly ConnectorScope[] },
  handler: (ctx: AuthedContext<P>) => Promise<unknown>,
) {
  return connectRoute<P>(async (ctx) => {
    const auth = await authenticateConnector(ctx.req, ctx.requestId, ctx.responseHeaders);
    const required: readonly ConnectorScope[] =
      options.scope === undefined ? [] : typeof options.scope === 'string' ? [options.scope] : options.scope;
    for (const scope of required) requireScope(auth, scope);
    return handler({ ...ctx, auth });
  });
}
