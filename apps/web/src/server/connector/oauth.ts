import {
  and,
  connectorCodes,
  connectorGrants,
  connectorUsedRefresh,
  eq,
  isNull,
  memberships,
  organizations,
  users,
} from 'database';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  connectorConfig,
  connectorTokenKind,
  generateAuthorizationCode,
  generateConnectorToken,
  hashAuthorizationCode,
  hashConnectorToken,
  isValidCodeChallenge,
  safeEqual,
  verifyPkceS256,
} from 'core';
import { grantableScopes, isConnectorScope, parseScopeParam, type ConnectorScope, type Role } from 'shared';
import { db } from '@/lib/db';
import { revokeGrantWith, type RevokeReason } from './grants';

/**
 * OAuth 2.0 authorization code + PKCE (RFC 6749 / 7636 / 7009) for one pre-registered confidential client, the Hub.
 * Every state change that must survive a failed request (burning a code, revoking a stolen family) is committed
 * before the error is raised.
 */

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'unauthorized_client'
  | 'unsupported_grant_type';

export class OAuthError extends Error {
  constructor(
    public readonly error: OAuthErrorCode,
    public readonly description: string,
    public readonly status = 400,
    public readonly headers: Record<string, string> = {},
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

// --- /connect/authorize ---------------------------------------------------------------------------------------------

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  scopes: ConnectorScope[];
  state: string;
  codeChallenge: string;
}

export type AuthorizeValidation =
  | { ok: true; request: AuthorizeRequest }
  /** Unknown client or redirect URI: show an error page, NEVER redirect (it could be an open redirect). */
  | { ok: false; display: 'page'; message: string }
  /** Everything else goes back to the client as `?error=…&state=…` (RFC 6749 §4.1.2.1). */
  | { ok: false; display: 'redirect'; redirectUri: string; error: string; description: string; state?: string };

export function validateAuthorizeRequest(p: Record<string, string | undefined>): AuthorizeValidation {
  const config = connectorConfig();
  const page = (message: string): AuthorizeValidation => ({ ok: false, display: 'page', message });
  if (!p.client_id || !safeEqual(p.client_id, config.clientId)) return page('This application is not registered with Orb.');
  if (!p.redirect_uri || !config.redirectUris.includes(p.redirect_uri)) return page('The return address of this request is not registered for the application.');

  const redirect = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    display: 'redirect',
    redirectUri: p.redirect_uri!,
    error,
    description,
    state: p.state,
  });
  if (p.response_type !== 'code') return redirect('unsupported_response_type', 'response_type must be "code"');
  if (!p.state) return redirect('invalid_request', 'state is required');
  if (!p.code_challenge || p.code_challenge_method !== 'S256' || !isValidCodeChallenge(p.code_challenge)) {
    return redirect('invalid_request', 'PKCE is required: send a code_challenge with code_challenge_method=S256');
  }
  const { scopes, unknown } = parseScopeParam(p.scope);
  if (unknown.length > 0) return redirect('invalid_scope', `Unknown scope: ${unknown.join(' ')}`);
  if (scopes.length === 0) return redirect('invalid_scope', 'At least one scope is required');

  return { ok: true, request: { clientId: config.clientId, redirectUri: p.redirect_uri, scopes, state: p.state, codeChallenge: p.code_challenge } };
}

/** `redirect_uri` plus parameters, keeping whatever query the registered URI already has. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

export interface ConsentOption {
  org: { id: string; name: string; slug: string; plan: string };
  role: Role;
  grantable: ConnectorScope[];
  withheld: ConnectorScope[];
}

/** Teams the user can connect: only those where their role satisfies at least one requested scope. */
export function consentOptions(memberships: Array<{ org: { id: string; name: string; slug: string; plan: string }; role: Role }>, requested: readonly ConnectorScope[]): ConsentOption[] {
  return memberships
    .map((m) => {
      const grantable = grantableScopes(m.role, requested);
      return { org: m.org, role: m.role, grantable, withheld: requested.filter((s) => !grantable.includes(s)) };
    })
    .filter((o) => o.grantable.length > 0);
}

export async function createAuthorizationCode(input: {
  userId: string;
  orgId: string;
  scopes: ConnectorScope[];
  request: AuthorizeRequest;
}): Promise<string> {
  const { code, hash } = generateAuthorizationCode();
  await db.insert(connectorCodes).values({
    codeHash: hash,
    clientId: input.request.clientId,
    userId: input.userId,
    orgId: input.orgId,
    scopes: input.scopes,
    redirectUri: input.request.redirectUri,
    codeChallenge: input.request.codeChallenge,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
  });
  return code;
}

// --- /oauth/token ------------------------------------------------------------------------------------------------------

/** HTTP Basic (form-urlencoded id and secret, RFC 6749 §2.3.1) or `client_id`/`client_secret` in the body. */
export function authenticateClient(req: Request, form: Record<string, string>): { clientId: string } {
  const config = connectorConfig();
  let id: string | undefined;
  let secret: string | undefined;
  const header = req.headers.get('authorization');
  if (header && /^basic\s+/i.test(header)) {
    const decoded = Buffer.from(header.replace(/^basic\s+/i, ''), 'base64').toString('utf8');
    const at = decoded.indexOf(':');
    if (at > 0) {
      try {
        id = decodeURIComponent(decoded.slice(0, at));
        secret = decodeURIComponent(decoded.slice(at + 1));
      } catch {
        /* malformed escape: fall through to invalid_client */
      }
    }
  } else {
    id = form.client_id;
    secret = form.client_secret;
  }
  // Both comparisons always run so the response time does not reveal which one failed.
  const idOk = safeEqual(id ?? '', config.clientId);
  const secretOk = safeEqual(secret ?? '', config.clientSecret);
  if (!id || !secret || !idOk || !secretOk) {
    throw new OAuthError('invalid_client', 'Client authentication failed', 401, { 'WWW-Authenticate': 'Basic realm="orb-connector"' });
  }
  return { clientId: config.clientId };
}

export interface TokenResponse {
  token_type: 'Bearer';
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  tenant: { id: string; name: string; kind: 'organization' };
  user: { id: string; email: string; name: string };
}

function tokenResponse(args: {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  org: { id: string; name: string };
  user: { id: string; email: string; name: string };
}): TokenResponse {
  return {
    token_type: 'Bearer',
    access_token: args.accessToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: args.refreshToken,
    scope: args.scopes.join(' '),
    tenant: { id: args.org.id, name: args.org.name, kind: 'organization' },
    user: { id: args.user.id, email: args.user.email, name: args.user.name },
  };
}

type Outcome<T> = { kind: 'ok'; value: T } | { kind: 'fail'; description: string };

async function roleOf(tx: Pick<typeof db, 'select'>, orgId: string, userId: string): Promise<Role | null> {
  const [m] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return (m?.role as Role | undefined) ?? null;
}

export async function exchangeAuthorizationCode(client: { clientId: string }, form: Record<string, string>): Promise<{ response: TokenResponse; grantId: string; orgId: string; userId: string }> {
  const { code, redirect_uri: redirectUri, code_verifier: verifier } = form;
  if (!code || !redirectUri || !verifier) throw new OAuthError('invalid_request', 'code, redirect_uri and code_verifier are required');

  const hash = hashAuthorizationCode(code);
  const now = new Date();
  const outcome = await db.transaction(async (tx): Promise<Outcome<{ response: TokenResponse; grantId: string; orgId: string; userId: string }>> => {
    // Claim the code atomically. Whatever happens next, it can never be used again.
    const [claimed] = await tx
      .update(connectorCodes)
      .set({ usedAt: now })
      .where(and(eq(connectorCodes.codeHash, hash), isNull(connectorCodes.usedAt)))
      .returning();
    if (!claimed) {
      // A second use is treated as theft: the tokens issued from the first use are revoked.
      const [prior] = await tx.select({ grantId: connectorCodes.grantId }).from(connectorCodes).where(eq(connectorCodes.codeHash, hash)).limit(1);
      if (prior?.grantId) await revokeGrantWith(tx, prior.grantId, 'code_reuse');
      return { kind: 'fail', description: 'The authorization code is invalid, expired or was already used' };
    }
    if (claimed.expiresAt.getTime() <= now.getTime()) return { kind: 'fail', description: 'The authorization code is invalid, expired or was already used' };
    if (!safeEqual(claimed.clientId, client.clientId)) return { kind: 'fail', description: 'The authorization code was issued to another client' };
    if (!safeEqual(claimed.redirectUri, redirectUri)) return { kind: 'fail', description: 'redirect_uri does not match the authorization request' };
    if (!verifyPkceS256(verifier, claimed.codeChallenge)) return { kind: 'fail', description: 'PKCE verification failed' };

    const role = await roleOf(tx, claimed.orgId, claimed.userId);
    if (!role) return { kind: 'fail', description: 'The user is no longer a member of the team' };
    const scopes = grantableScopes(role, claimed.scopes.filter(isConnectorScope));
    if (scopes.length === 0) return { kind: 'fail', description: 'The user no longer holds a role that allows these scopes' };

    const [owner] = await tx
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, claimed.orgId))
      .where(eq(users.id, claimed.userId))
      .limit(1);
    if (!owner) return { kind: 'fail', description: 'The user or team no longer exists' };

    const access = generateConnectorToken('access');
    const refresh = generateConnectorToken('refresh');
    const [grant] = await tx
      .insert(connectorGrants)
      .values({
        clientId: claimed.clientId,
        userId: claimed.userId,
        orgId: claimed.orgId,
        scopes,
        accessHash: access.hash,
        accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
        refreshHash: refresh.hash,
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      })
      .returning({ id: connectorGrants.id });
    await tx.update(connectorCodes).set({ grantId: grant!.id }).where(eq(connectorCodes.codeHash, hash));

    return {
      kind: 'ok',
      value: {
        grantId: grant!.id,
        orgId: claimed.orgId,
        userId: claimed.userId,
        response: tokenResponse({ accessToken: access.token, refreshToken: refresh.token, scopes, org: owner.org, user: owner.user }),
      },
    };
  });
  if (outcome.kind === 'fail') throw new OAuthError('invalid_grant', outcome.description);
  return outcome.value;
}

export async function refreshTokens(client: { clientId: string }, form: Record<string, string>): Promise<{ response: TokenResponse; grantId: string; orgId: string; userId: string }> {
  const presented = form.refresh_token;
  if (!presented) throw new OAuthError('invalid_request', 'refresh_token is required');
  if (connectorTokenKind(presented) !== 'refresh') throw new OAuthError('invalid_grant', 'The refresh token is invalid');
  const hash = hashConnectorToken(presented);
  const now = new Date();
  const requested = form.scope ? parseScopeParam(form.scope) : null;
  if (requested && requested.unknown.length > 0) throw new OAuthError('invalid_scope', `Unknown scope: ${requested.unknown.join(' ')}`);

  const outcome = await db.transaction(async (tx): Promise<Outcome<{ response: TokenResponse; grantId: string; orgId: string; userId: string }>> => {
    // Serialises concurrent refreshes of one grant.
    const [grant] = await tx.select().from(connectorGrants).where(eq(connectorGrants.refreshHash, hash)).for('update').limit(1);
    if (!grant) {
      // An already-rotated token proves somebody holds a stale copy: revoke the whole family (theft detection).
      const [used] = await tx.select({ grantId: connectorUsedRefresh.grantId }).from(connectorUsedRefresh).where(eq(connectorUsedRefresh.refreshHash, hash)).limit(1);
      if (used) await revokeGrantWith(tx, used.grantId, 'reuse_detected');
      return { kind: 'fail', description: 'The refresh token is invalid, expired or was already used' };
    }
    if (grant.revokedAt || grant.refreshExpiresAt.getTime() <= now.getTime()) return { kind: 'fail', description: 'The refresh token is invalid, expired or was already used' };
    if (!safeEqual(grant.clientId, client.clientId)) return { kind: 'fail', description: 'The refresh token was issued to another client' };

    const role = await roleOf(tx, grant.orgId, grant.userId);
    if (!role) {
      await revokeGrantWith(tx, grant.id, 'membership_lost');
      return { kind: 'fail', description: 'The user is no longer a member of the team' };
    }
    let scopes = grant.scopes;
    if (requested) {
      if (!requested.scopes.every((s) => grant.scopes.includes(s))) return { kind: 'fail', description: 'Requested scopes exceed the originally granted scopes' };
      scopes = requested.scopes;
    }

    const access = generateConnectorToken('access');
    const refresh = generateConnectorToken('refresh');
    await tx.insert(connectorUsedRefresh).values({ refreshHash: hash, grantId: grant.id });
    await tx
      .update(connectorGrants)
      .set({
        scopes,
        accessHash: access.hash,
        accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
        refreshHash: refresh.hash,
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      })
      .where(eq(connectorGrants.id, grant.id));

    const [owner] = await tx
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, grant.orgId))
      .where(eq(users.id, grant.userId))
      .limit(1);
    if (!owner) return { kind: 'fail', description: 'The user or team no longer exists' };
    return {
      kind: 'ok',
      value: {
        grantId: grant.id,
        orgId: grant.orgId,
        userId: grant.userId,
        response: tokenResponse({ accessToken: access.token, refreshToken: refresh.token, scopes: grantableScopes(role, scopes.filter(isConnectorScope)), org: owner.org, user: owner.user }),
      },
    };
  });
  if (outcome.kind === 'fail') throw new OAuthError('invalid_grant', outcome.description);
  return outcome.value;
}

/** RFC 7009: unknown, expired and already-revoked tokens are not an error. Returns the revoked grant, if any. */
export async function revokeByToken(token: string): Promise<{ grantId: string; orgId: string; userId: string; clientId: string } | null> {
  const kind = connectorTokenKind(token);
  if (kind !== 'access' && kind !== 'refresh') return null;
  const hash = hashConnectorToken(token);
  const [grant] = await db
    .select({ id: connectorGrants.id })
    .from(connectorGrants)
    .where(kind === 'access' ? eq(connectorGrants.accessHash, hash) : eq(connectorGrants.refreshHash, hash))
    .limit(1);
  let grantId = grant?.id;
  if (!grantId && kind === 'refresh') {
    const [used] = await db.select({ grantId: connectorUsedRefresh.grantId }).from(connectorUsedRefresh).where(eq(connectorUsedRefresh.refreshHash, hash)).limit(1);
    grantId = used?.grantId;
  }
  if (!grantId) return null;
  const revoked = await db.transaction((tx) => revokeGrantWith(tx, grantId, 'client' satisfies RevokeReason));
  return revoked ? { grantId: revoked.id, orgId: revoked.orgId, userId: revoked.userId, clientId: revoked.clientId } : null;
}
