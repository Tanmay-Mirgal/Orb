import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from 'database/src/schema';

vi.mock('@/lib/db', async () => (await import('./testing/harness')).dbModule());
vi.mock('@/lib/auth', async () => (await import('./testing/harness')).authModule());
vi.mock('@/server/infra', async () => (await import('./testing/harness')).infraModule());
vi.mock('core', async (importOriginal) => (await import('./testing/harness')).coreOverrides(await importOriginal()));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { hashConnectorToken } from 'core';
import { validateAuthorizeRequest } from './oauth';
import { HUB_ENV, harness, linkGithub, removeMember, seedOrg, seedUser, setRole, type Harness, type TestUser } from './testing/harness';
import { CLIENT_ID, REDIRECT_URI, authorizeQuery, call, connect, pkce, postDecision, tokenRequest } from './testing/flow';

let h: Harness;
let owner: TestUser;
let org: Awaited<ReturnType<typeof seedOrg>>;

const ALL_READ = 'orb:orgs:read orb:projects:read orb:deployments:read orb:domains:read orb:logs:read orb:analytics:read';
const WRITE = 'orb:projects:write orb:deployments:write orb:env:write orb:domains:write orb:webhooks:manage';

beforeAll(async () => {
  for (const [k, v] of Object.entries(HUB_ENV)) vi.stubEnv(k, v);
  h = await harness();
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  h.redis.flush();
  h.session.user = null;
  await h.client.exec(
    'TRUNCATE connector_grants, connector_codes, connector_used_refresh, connector_webhooks, connector_events, connector_deliveries, connector_operations, connector_idempotency, audit_logs CASCADE',
  );
  owner = await seedUser(h, { name: 'Olivia Owner' });
  org = await seedOrg(h, owner.id, 'Acme');
});

const query = (overrides: Partial<Parameters<typeof authorizeQuery>[0]> = {}) => authorizeQuery({ scope: 'orb:projects:read', state: 'abc', challenge: pkce().challenge, ...overrides });

describe('authorize request validation', () => {
  it('shows an error page, never a redirect, for an unknown client or return address (C04)', () => {
    const unknownClient = validateAuthorizeRequest(query({ clientId: 'evil' }));
    expect(unknownClient).toMatchObject({ ok: false, display: 'page' });
    for (const redirectUri of [
      'https://hub.example.com/callback/',
      'https://hub.example.com/callback?x=1',
      'https://hub.example.com/other',
      'http://hub.example.com/callback',
      'https://evil.example.com/callback',
      'https://hub.example.com.evil.com/callback',
      'HTTPS://hub.example.com/callback',
    ]) {
      expect(validateAuthorizeRequest(query({ redirectUri })), redirectUri).toMatchObject({ ok: false, display: 'page' });
    }
    expect(validateAuthorizeRequest({ ...query(), redirect_uri: '' })).toMatchObject({ ok: false, display: 'page' });
  });

  it('accepts only the registered return addresses, exactly', () => {
    expect(validateAuthorizeRequest(query())).toMatchObject({ ok: true });
    expect(validateAuthorizeRequest(query({ redirectUri: 'http://localhost:3100/callback' }))).toMatchObject({ ok: true });
  });

  it('requires PKCE with S256 and a state, and reports the error to the client with its state (C02)', () => {
    expect(validateAuthorizeRequest(query({ method: 'plain' }))).toMatchObject({ ok: false, display: 'redirect', error: 'invalid_request', state: 'abc' });
    expect(validateAuthorizeRequest({ ...query(), code_challenge: '' })).toMatchObject({ ok: false, display: 'redirect', error: 'invalid_request' });
    expect(validateAuthorizeRequest({ ...query(), code_challenge: 'too-short' })).toMatchObject({ ok: false, display: 'redirect', error: 'invalid_request' });
    expect(validateAuthorizeRequest(query({ state: undefined }))).toMatchObject({ ok: false, display: 'redirect', error: 'invalid_request' });
    expect(validateAuthorizeRequest(query({ responseType: 'token' }))).toMatchObject({ ok: false, display: 'redirect', error: 'unsupported_response_type' });
  });

  it('rejects unknown and missing scopes', () => {
    expect(validateAuthorizeRequest(query({ scope: 'orb:projects:read orb:nuke' }))).toMatchObject({ ok: false, error: 'invalid_scope' });
    expect(validateAuthorizeRequest(query({ scope: '' }))).toMatchObject({ ok: false, error: 'invalid_scope' });
  });
});

describe('consent decision', () => {
  const decide = (user: TestUser | null, extra: Record<string, string>, scope = ALL_READ, headers: Record<string, string> = {}) =>
    postDecision(h, user, { ...query({ scope }), ...extra }, headers);

  it('sends a signed-out user to the login page and brings them back to the same request', async () => {
    const res = await decide(null, { org_id: org.id, decision: 'allow' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!, 'https://orb.example.com');
    expect(location.pathname).toBe('/login');
    const next = location.searchParams.get('next')!;
    expect(next.startsWith('/connect/authorize?')).toBe(true);
    expect(new URLSearchParams(next.split('?')[1]).get('client_id')).toBe(CLIENT_ID);
  });

  it('refuses a cross-site form post', async () => {
    const res = await decide(owner, { org_id: org.id, decision: 'allow' }, ALL_READ, { origin: 'https://evil.example.com' });
    expect(res.status).toBe(403);
    expect(await h.db.select().from(schema.connectorCodes)).toHaveLength(0);
  });

  it('returns access_denied with the state when the user cancels', async () => {
    const res = await decide(owner, { org_id: org.id, decision: 'deny' });
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.has('code')).toBe(false);
  });

  it('issues a single-use 60 second code bound to client, user, team, scopes, redirect and challenge', async () => {
    const q = query({ scope: 'orb:projects:read orb:projects:write' });
    const res = await postDecision(h, owner, { ...q, org_id: org.id, decision: 'allow' });
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('state')).toBe('abc');
    const code = url.searchParams.get('code')!;
    expect(code.length).toBeGreaterThanOrEqual(43);
    const [row] = await h.db.select().from(schema.connectorCodes).where(eq(schema.connectorCodes.userId, owner.id));
    expect(row).toMatchObject({ clientId: CLIENT_ID, orgId: org.id, redirectUri: REDIRECT_URI, codeChallenge: q.code_challenge, usedAt: null });
    expect([...row!.scopes].sort()).toEqual(['orb:projects:read', 'orb:projects:write']);
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(55_000);
    expect(row!.codeHash).not.toContain(code); // only a hash is stored
  });

  it('grants write scopes only where the role allows them, and never to a viewer', async () => {
    const viewer = await seedUser(h);
    const member = await seedUser(h);
    await setRole(h, org.id, viewer.id, 'viewer');
    await setRole(h, org.id, member.id, 'member');
    const scope = `${ALL_READ} ${WRITE}`;

    const scopesOf = async (user: TestUser) => {
      const res = await decide(user, { org_id: org.id, decision: 'allow' }, scope);
      const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
      const [row] = await h.db.select().from(schema.connectorCodes).where(eq(schema.connectorCodes.codeHash, hashConnectorToken(`code:${code}`)));
      return row!.scopes;
    };
    const viewerScopes = await scopesOf(viewer);
    expect(viewerScopes.some((s) => /write|manage/.test(s))).toBe(false);
    expect(viewerScopes).toContain('orb:projects:read');
    const memberScopes = await scopesOf(member);
    expect(memberScopes).toContain('orb:projects:write');
    expect(memberScopes).toContain('orb:env:write');
    expect(memberScopes).not.toContain('orb:domains:write'); // admin only
    expect(await scopesOf(owner)).toContain('orb:domains:write');
  });

  it('refuses a team the user does not belong to, and a team that was not offered', async () => {
    const stranger = await seedUser(h);
    expect((await decide(stranger, { org_id: org.id, decision: 'allow' })).status).toBe(400);
    expect((await decide(owner, { decision: 'allow' })).status).toBe(400);
    expect((await decide(owner, { org_id: 'not-a-team', decision: 'allow' })).status).toBe(400);
    expect(await h.db.select().from(schema.connectorCodes)).toHaveLength(0);
  });

  it('validates the whole request again on submit', async () => {
    const bad = await postDecision(h, owner, { ...query({ redirectUri: 'https://evil.example.com/cb' }), org_id: org.id, decision: 'allow' });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('location')).toBeNull();
    expect(await h.db.select().from(schema.connectorCodes)).toHaveLength(0);
  });
});

describe('token endpoint', () => {
  const issueCode = async (scope = 'orb:projects:read orb:projects:write') => {
    const { verifier, challenge } = pkce();
    const res = await postDecision(h, owner, { ...authorizeQuery({ scope, state: 's', challenge }), org_id: org.id, decision: 'allow' });
    return { code: new URL(res.headers.get('location')!).searchParams.get('code')!, verifier };
  };
  const exchange = (code: string, verifier: string, extra: Record<string, string> = {}) =>
    tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier, ...extra });

  it('exchanges a code for opaque tokens and stores only their HMAC', async () => {
    const { code, verifier } = await issueCode();
    const res = await exchange(code, verifier);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: expect.stringContaining('orb:projects:read'),
      tenant: { id: org.id, name: 'Acme', kind: 'organization' },
      user: { id: owner.id, email: owner.email, name: 'Olivia Owner' },
    });
    expect(body.access_token).toMatch(/^cp1_orb_[A-Za-z0-9_-]{43,}$/);
    expect(body.refresh_token).toMatch(/^cp1r_orb_[A-Za-z0-9_-]{43,}$/);

    const [grant] = await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.userId, owner.id));
    expect(grant!.accessHash).toBe(hashConnectorToken(body.access_token));
    expect(grant!.refreshHash).toBe(hashConnectorToken(body.refresh_token));
    expect(JSON.stringify(grant)).not.toContain(body.access_token);
    expect(JSON.stringify(grant)).not.toContain(body.refresh_token);
    expect(grant!.refreshExpiresAt.getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);
    expect(grant!.accessExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
  });

  it('accepts HTTP Basic client authentication and JSON bodies', async () => {
    const a = await issueCode();
    expect((await tokenRequest({ grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT_URI, code_verifier: a.verifier }, { basic: true })).status).toBe(200);
    const b = await issueCode();
    expect((await tokenRequest({ grant_type: 'authorization_code', code: b.code, redirect_uri: REDIRECT_URI, code_verifier: b.verifier }, { json: true })).status).toBe(200);
  });

  it('rejects wrong or missing client credentials without burning the code', async () => {
    const { code, verifier } = await issueCode();
    const noAuth = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }, { auth: false });
    expect(noAuth.status).toBe(401);
    expect(await noAuth.json()).toMatchObject({ error: 'invalid_client' });
    const wrong = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier, client_id: CLIENT_ID, client_secret: 'nope' }, { auth: false });
    expect(wrong.status).toBe(401);
    expect((await exchange(code, verifier)).status).toBe(200); // still usable
  });

  it('fails PKCE with a wrong verifier and burns the code (C02)', async () => {
    const { code, verifier } = await issueCode();
    const bad = await exchange(code, `${verifier.slice(1)}x`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await exchange(code, verifier)).status).toBe(400); // the right verifier is too late
    expect(await h.db.select().from(schema.connectorGrants)).toHaveLength(0);
  });

  it('is single use, and a second use revokes the tokens issued from the first (C03)', async () => {
    const { code, verifier } = await issueCode();
    const first = await (await exchange(code, verifier)).json();
    const { GET } = await import('@/app/api/connect/v1/me/route');
    expect((await call(GET, '/api/connect/v1/me', { token: first.access_token })).status).toBe(200);

    const second = await exchange(code, verifier);
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await call(GET, '/api/connect/v1/me', { token: first.access_token })).status).toBe(401);
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(refreshed.status).toBe(400);
  });

  it('requires the exact redirect_uri of the authorization request (C04)', async () => {
    const { code, verifier } = await issueCode();
    const res = await exchange(code, verifier, { redirect_uri: 'http://localhost:3100/callback' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('rejects an expired code', async () => {
    const { code, verifier } = await issueCode();
    await h.db.update(schema.connectorCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await exchange(code, verifier)).status).toBe(400);
  });

  it('answers RFC 6749 errors for bad requests', async () => {
    expect(await (await tokenRequest({ grant_type: 'password' })).json()).toMatchObject({ error: 'unsupported_grant_type' });
    expect(await (await tokenRequest({ grant_type: 'authorization_code' })).json()).toMatchObject({ error: 'invalid_request' });
    expect(await (await tokenRequest({ grant_type: 'refresh_token' })).json()).toMatchObject({ error: 'invalid_request' });
    expect(await (await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'cp1r_orb_nonsense' })).json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('does not issue tokens when the user lost their role between consent and exchange', async () => {
    const { code, verifier } = await issueCode();
    await removeMember(h, org.id, owner.id);
    const res = await exchange(code, verifier);
    expect(res.status).toBe(400);
    expect(await h.db.select().from(schema.connectorGrants)).toHaveLength(0);
  });
});

describe('refresh tokens', () => {
  it('rotates: every refresh returns new tokens and retires the old ones (C05)', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const res = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh });
    expect(res.status).toBe(200);
    const next = await res.json();
    expect(next.refresh_token).not.toBe(c.refresh);
    expect(next.access_token).not.toBe(c.access);
    expect(next.tenant.id).toBe(org.id);
    expect((await call(GET, '/api/connect/v1/me', { token: next.access_token })).status).toBe(200);
    expect((await call(GET, '/api/connect/v1/me', { token: c.access })).status).toBe(401);
  });

  it('treats a rotated refresh token as theft and revokes the whole grant (C05)', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const next = await (await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh })).json();
    const replay = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    // the legitimate holder of the newest tokens is cut off too
    expect((await call(GET, '/api/connect/v1/me', { token: next.access_token })).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: next.refresh_token })).status).toBe(400);
    const [grant] = await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, c.grantId));
    expect(grant!.revokedAt).not.toBeNull();
    expect(grant!.revokeReason).toBe('reuse_detected');
  });

  it('can narrow scopes but never widen them', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read orb:projects:write');
    const widen = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh, scope: 'orb:projects:read orb:domains:write' });
    expect(widen.status).toBe(400);
    const [afterWiden] = await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, c.grantId));
    expect(afterWiden!.revokedAt).toBeNull(); // a refused request is not theft
    const narrow = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh, scope: 'orb:projects:read' });
    expect(narrow.status).toBe(200);
    expect((await narrow.json()).scope).toBe('orb:projects:read');
  });

  it('stops working after 90 days and when the access token is used as a refresh token', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.access })).status).toBe(400);
    await h.db.update(schema.connectorGrants).set({ refreshExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.connectorGrants.id, c.grantId));
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh })).status).toBe(400);
  });

  it('revokes the grant when the user left the team', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const second = await seedUser(h);
    await setRole(h, org.id, second.id, 'owner'); // so the team is not left without an owner
    await removeMember(h, org.id, owner.id);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh })).status).toBe(400);
    const [grant] = await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, c.grantId));
    expect(grant!.revokedAt).not.toBeNull();
  });
});

describe('revocation (C06)', () => {
  const revoke = async (token: string) => {
    const { POST } = await import('@/app/api/connect/v1/oauth/revoke/route');
    return POST(new Request('https://orb.example.com/api/connect/v1/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }));
  };

  it('takes effect immediately for the access and the refresh token', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const { GET } = await import('@/app/api/connect/v1/me/route');
    expect((await call(GET, '/api/connect/v1/me', { token: c.access })).status).toBe(200);
    expect((await revoke(c.access)).status).toBe(200);
    expect((await call(GET, '/api/connect/v1/me', { token: c.access })).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh })).status).toBe(400);
  });

  it('works with the refresh token too and removes the webhook endpoints of the grant', async () => {
    const c = await connect(h, owner, org.id, 'orb:projects:read orb:webhooks:manage');
    await h.db.insert(schema.connectorWebhooks).values({ grantId: c.grantId, orgId: org.id, url: 'https://hub.example.com/hook', eventFilter: ['deployment.*'], secretEnc: 'enc:v1:x' });
    expect((await revoke(c.refresh)).status).toBe(200);
    expect(await h.db.select().from(schema.connectorWebhooks).where(eq(schema.connectorWebhooks.grantId, c.grantId))).toHaveLength(0);
    const [grant] = await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, c.grantId));
    expect(grant!.revokeReason).toBe('client');
  });

  it('always answers 200, even for unknown or malformed tokens (RFC 7009)', async () => {
    expect((await revoke('cp1_orb_doesnotexist')).status).toBe(200);
    expect((await revoke('garbage')).status).toBe(200);
    const { POST } = await import('@/app/api/connect/v1/oauth/revoke/route');
    expect((await POST(new Request('https://orb.example.com/x', { method: 'POST', body: '' }))).status).toBe(200);
  });
});

describe('GET /me and request-time authorization (C07, C08, C09, C21)', () => {
  it('rejects missing, malformed, wrong-kind and unknown tokens with the CP1 error shape (C11)', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    for (const token of [undefined, 'nope', 'orb_personal_token', c.refresh, 'cp1_orb_unknown']) {
      const res = await call(GET, '/api/connect/v1/me', { token });
      expect(res.status, String(token)).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Bearer');
      const body = await res.json();
      expect(body.error).toMatchObject({ code: 'unauthorized', retryable: false });
      expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
    }
    const basic = await GET(new Request('https://orb.example.com/api/connect/v1/me', { headers: { authorization: 'Basic abc' } }), { params: Promise.resolve({}) });
    expect(basic.status).toBe(401);
  });

  it('does not accept personal API tokens or session cookies', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    h.session.user = owner;
    const res = await call(GET, '/api/connect/v1/me', { headers: { cookie: 'better-auth.session_token=abc' } });
    expect(res.status).toBe(401);
  });

  it('returns the connection and exposes no secret material', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const c = await connect(h, owner, org.id, 'orb:projects:read orb:projects:write');
    const res = await call(GET, '/api/connect/v1/me', { token: c.access });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const raw = await res.text();
    const me = JSON.parse(raw);
    expect(me).toMatchObject({
      user: { id: owner.id, email: owner.email },
      tenant: { id: org.id, name: 'Acme', kind: 'organization' },
      grantId: c.grantId,
      plan: { id: 'pro', limits: { maxProjects: 50 }, usage: { projects: 0, members: 1 } },
      capabilities: { githubConnected: false, githubLogin: null, githubAppInstallUrl: 'https://github.com/apps/orb-test/installations/new', role: 'owner', plan: 'pro' },
    });
    expect(me.scopes).toEqual(['orb:projects:read', 'orb:projects:write']);
    for (const secret of [c.access, c.refresh, 'hub-secret', 'pepper', 'encryption-key', hashConnectorToken(c.access)]) expect(raw).not.toContain(secret);
    expect(raw).not.toMatch(/hash|accessToken|password|secret/i);
  });

  it('reports the GitHub link of the connecting user', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    await linkGithub(h, owner.id);
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const me = await (await call(GET, '/api/connect/v1/me', { token: c.access })).json();
    expect(me.capabilities).toMatchObject({ githubConnected: true, githubLogin: 'octocat' });
  });

  it('is pinned to one team: asking for another one is forbidden, asking for its own is fine', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const other = await seedOrg(h, owner.id, 'Other');
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    expect((await call(GET, '/api/connect/v1/me', { token: c.access, headers: { 'x-orb-org': other.id } })).status).toBe(403);
    expect((await call(GET, `/api/connect/v1/me?orgId=${other.id}`, { token: c.access })).status).toBe(403);
    expect((await call(GET, '/api/connect/v1/me', { token: c.access, headers: { 'x-orb-org': org.id } })).status).toBe(200);
  });

  it('applies a role downgrade on the very next call (C09)', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const admin = await seedUser(h);
    await setRole(h, org.id, admin.id, 'admin');
    const c = await connect(h, admin, org.id, 'orb:projects:read orb:projects:write orb:domains:write');
    const before = await (await call(GET, '/api/connect/v1/me', { token: c.access })).json();
    expect(before.scopes).toContain('orb:domains:write');

    await setRole(h, org.id, admin.id, 'member');
    const member = await (await call(GET, '/api/connect/v1/me', { token: c.access })).json();
    expect(member.scopes).toEqual(['orb:projects:read', 'orb:projects:write']);

    await setRole(h, org.id, admin.id, 'viewer');
    const viewer = await (await call(GET, '/api/connect/v1/me', { token: c.access })).json();
    expect(viewer.scopes).toEqual(['orb:projects:read']);
    expect(viewer.capabilities.role).toBe('viewer');

    await setRole(h, org.id, admin.id, 'admin'); // the cap lifts again: the grant itself never changed
    expect((await (await call(GET, '/api/connect/v1/me', { token: c.access })).json()).scopes).toContain('orb:domains:write');
  });

  it('rejects the call and revokes the grant once the user left the team', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const member = await seedUser(h);
    await setRole(h, org.id, member.id, 'member');
    const c = await connect(h, member, org.id, 'orb:projects:read');
    await removeMember(h, org.id, member.id);
    expect((await call(GET, '/api/connect/v1/me', { token: c.access })).status).toBe(401);
    const [grant] = await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, c.grantId));
    expect(grant!.revokeReason).toBe('membership_lost');
  });

  it('refuses an expired access token', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    await h.db.update(schema.connectorGrants).set({ accessExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.connectorGrants.id, c.grantId));
    expect((await call(GET, '/api/connect/v1/me', { token: c.access })).status).toBe(401);
  });

  it('updates lastUsedAt at most once per five minutes', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const read = async () => (await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, c.grantId)))[0]!.lastUsedAt;
    expect(await read()).toBeNull();
    await call(GET, '/api/connect/v1/me', { token: c.access });
    await new Promise((r) => setTimeout(r, 100));
    const first = await read();
    expect(first).not.toBeNull();
    await call(GET, '/api/connect/v1/me', { token: c.access });
    await new Promise((r) => setTimeout(r, 100));
    expect((await read())!.getTime()).toBe(first!.getTime());
    await h.db.update(schema.connectorGrants).set({ lastUsedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(schema.connectorGrants.id, c.grantId));
    await call(GET, '/api/connect/v1/me', { token: c.access });
    await new Promise((r) => setTimeout(r, 100));
    expect((await read())!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('sends rate-limit headers and answers 429 with Retry-After beyond the per-grant limit (C13)', async () => {
    const { GET } = await import('@/app/api/connect/v1/me/route');
    const c = await connect(h, owner, org.id, 'orb:projects:read');
    const first = await call(GET, '/api/connect/v1/me', { token: c.access });
    expect(first.headers.get('x-ratelimit-limit')).toBe('120');
    expect(Number(first.headers.get('x-ratelimit-remaining'))).toBeLessThanOrEqual(119);
    expect(Number(first.headers.get('x-ratelimit-reset'))).toBeGreaterThan(Date.now() / 1000 - 1);

    h.redis.flush();
    // 120 allowed per minute: burn the budget directly, then the next call is refused
    const key = `orb:rl:cp1:grant:${c.grantId}:${Math.floor(Date.now() / 1000 / 60)}`;
    for (let i = 0; i < 120; i++) await h.redis.incr(key);
    const limited = await call(GET, '/api/connect/v1/me', { token: c.access });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
    const body = await limited.json();
    expect(body.error).toMatchObject({ code: 'rate_limited', retryable: true });
  });
});

describe('connected apps (dashboard)', () => {
  it('lists connections for their owner and for team admins, and lets both disconnect', async () => {
    const { GET } = await import('@/app/api/v1/connector/grants/route');
    const { DELETE } = await import('@/app/api/v1/connector/grants/[id]/route');
    const member = await seedUser(h, { name: 'Mia Member' });
    const admin = await seedUser(h);
    await setRole(h, org.id, member.id, 'member');
    await setRole(h, org.id, admin.id, 'admin');
    const c = await connect(h, member, org.id, 'orb:projects:read orb:webhooks:manage');
    await h.db.insert(schema.connectorWebhooks).values({ grantId: c.grantId, orgId: org.id, url: 'https://hub.example.com/hooks/secret-path-token?k=1', eventFilter: ['*'], secretEnc: 'enc:v1:x', status: 'disabled', disabledReason: 'endpoint_gone' });

    const list = async (user: TestUser) => {
      h.session.user = user;
      const res = await call(GET, '/api/v1/connector/grants');
      return { status: res.status, body: await res.json() };
    };
    const mine = await list(member);
    expect(mine.status).toBe(200);
    expect(mine.body.hubName).toBe('Test Hub');
    expect(mine.body.grants).toHaveLength(1);
    expect(mine.body.grants[0]).toMatchObject({ org: { id: org.id }, connectedBy: { name: 'Mia Member' }, canRevoke: true });
    expect(mine.body.grants[0].webhooks[0]).toMatchObject({ status: 'disabled', disabledReason: 'endpoint_gone' });
    expect(JSON.stringify(mine.body)).not.toMatch(/secret-path-token|secretEnc|accessHash|refreshHash/);
    expect(mine.body.activity.length).toBeGreaterThan(0);

    expect((await list(admin)).body.grants).toHaveLength(1);
    expect((await list(owner)).body.grants).toHaveLength(1);
    const stranger = await seedUser(h);
    expect((await list(stranger)).body.grants).toHaveLength(0);

    h.session.user = stranger;
    expect((await call(DELETE, `/api/v1/connector/grants/${c.grantId}`, { method: 'DELETE', params: { id: c.grantId } })).status).toBe(404);

    h.session.user = admin;
    expect((await call(DELETE, `/api/v1/connector/grants/${c.grantId}`, { method: 'DELETE', params: { id: c.grantId } })).status).toBe(200);
    const { GET: me } = await import('@/app/api/connect/v1/me/route');
    expect((await call(me, '/api/connect/v1/me', { token: c.access })).status).toBe(401);
    expect((await list(member)).body.grants).toHaveLength(0);
    const audits = await h.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, org.id), eq(schema.auditLogs.action, 'connector.grant_revoked')));
    expect(audits).toHaveLength(1);
  });

  it('is not reachable with a personal API token', async () => {
    const { GET } = await import('@/app/api/v1/connector/grants/route');
    h.session.user = null;
    const res = await call(GET, '/api/v1/connector/grants', { token: 'orb_abc' });
    expect([401, 403]).toContain(res.status);
  });
});

describe('feature flag off (C22)', () => {
  it('answers 404 on every connector route', async () => {
    vi.stubEnv('CONNECTOR_ENABLED', 'false');
    try {
      const me = await import('@/app/api/connect/v1/me/route');
      const token = await import('@/app/api/connect/v1/oauth/token/route');
      const revoke = await import('@/app/api/connect/v1/oauth/revoke/route');
      expect((await call(me.GET, '/api/connect/v1/me', { token: 'cp1_orb_x' })).status).toBe(404);
      expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'x' })).status).toBe(404);
      expect((await call(token.POST, '/api/connect/v1/oauth/token', { method: 'POST' })).status).toBe(404);
      expect((await call(revoke.POST, '/api/connect/v1/oauth/revoke', { method: 'POST' })).status).toBe(404);
      expect((await postDecision(h, owner, { ...query(), org_id: org.id, decision: 'allow' })).status).toBe(404);
      const grants = await import('@/app/api/v1/connector/grants/route');
      h.session.user = owner;
      expect((await call(grants.GET, '/api/v1/connector/grants')).status).toBe(404);
      expect(await h.db.select().from(schema.connectorCodes)).toHaveLength(0);
    } finally {
      vi.stubEnv('CONNECTOR_ENABLED', 'true');
    }
  });
});
