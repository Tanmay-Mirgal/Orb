import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from 'database/src/schema';

vi.mock('@/lib/db', async () => (await import('./testing/harness')).dbModule());
vi.mock('@/lib/auth', async () => (await import('./testing/harness')).authModule());
vi.mock('@/server/infra', async () => (await import('./testing/harness')).infraModule());
vi.mock('core', async (importOriginal) => (await import('./testing/harness')).coreOverrides(await importOriginal()));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { verifyWebhookSignature } from 'core';
import { deliverDue, emitConnectorEvent, fanOutEvents, runConnectorDispatch, withOutbox, emitProjectEvent } from 'database';
import { ACTIONS, CONNECTOR_SCOPE_NAMES, RESOURCES, buildManifest, toJsonSchema } from 'shared';
import { HANDLERS } from './actions';
import { actionRoute, operationRoute } from './dispatch';
import { manifestRoute } from './discovery';
import { meRoute } from './me';
import * as R from './resources';
import { validateAuthorizeRequest } from './oauth';
import { eventsList, webhooksCreate, webhooksGet, webhooksList } from './webhooks';
import { HUB_ENV, RESET_SQL, harness, linkGithub, seedDeployment, seedOrg, seedProject, seedUser, setRole, type Harness, type TestUser } from './testing/harness';
import { startReceiver } from './testing/receiver';
import { CLIENT_ID, REDIRECT_URI, authorizeQuery, connect, pkce, postDecision, tokenRequest } from './testing/flow';

/**
 * CP1 conformance, one block per item of the protocol's list (C01–C22), exercised through the real route handlers.
 * The detailed behaviour of each area is covered further in oauth/resources/actions/events/webhooks tests; this file
 * is the contract a Hub relies on, kept in one place.
 */

type Route = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let h: Harness;
let userA: TestUser;
let userB: TestUser;
let orgA: Awaited<ReturnType<typeof seedOrg>>;
let orgB: Awaited<ReturnType<typeof seedOrg>>;
let tokenA: string;
let tokenB: string;
let grantA: string;

const ALL = CONNECTOR_SCOPE_NAMES.join(' ');
const DEV = { production: false, allowPrivate: true };
const REPO = { id: 11, full_name: 'acme/site', default_branch: 'main', files: { 'index.html': '<h1>hi</h1>' } };

async function http(handler: unknown, method: string, p: string, token?: string, body?: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Response> {
  const all: Record<string, string> = { ...headers };
  if (token) all.authorization = `Bearer ${token}`;
  if (body !== undefined) all['content-type'] = 'application/json';
  return (handler as Route)(new Request(`https://orb.example.com/api/connect/v1${p}`, { method, headers: all, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
}

const act = (name: string, input: unknown, token = tokenA, headers: Record<string, string> = {}) => http(actionRoute, 'POST', `/actions/${name}`, token, { input }, { name }, headers);
async function ok(name: string, input: unknown, token = tokenA) {
  const res = await act(name, input, token);
  const body = await res.json();
  if (res.status >= 300) throw new Error(`${name}: ${res.status} ${JSON.stringify(body)}`);
  return body.output;
}
const createSite = (extra: Record<string, unknown> = {}) => ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false, ...extra });

beforeAll(async () => {
  for (const [k, v] of Object.entries({ ...HUB_ENV, CONNECTOR_ALLOW_PRIVATE_WEBHOOKS: 'true' })) vi.stubEnv(k, v);
  h = await harness();
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv('CONNECTOR_ENABLED', 'true');
  vi.stubEnv('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', 'true');
  h.redis.flush();
  h.session.user = null;
  h.github.repos = [REPO];
  await h.client.exec(RESET_SQL);
  userA = await seedUser(h, { name: 'Ann A' });
  userB = await seedUser(h, { name: 'Ben B' });
  orgA = await seedOrg(h, userA.id, 'Team A');
  orgB = await seedOrg(h, userB.id, 'Team B');
  await linkGithub(h, userA.id);
  const a = await connect(h, userA, orgA.id, ALL);
  tokenA = a.access;
  grantA = a.grantId;
  tokenB = (await connect(h, userB, orgB.id, ALL)).access;
});

describe('C01 manifest valid and matches the registry', () => {
  it('is served from the registry and every entry is backed by a handler and a route', async () => {
    const manifest = await (await http(manifestRoute, 'GET', '/manifest')).json();
    expect(manifest).toEqual(JSON.parse(JSON.stringify(buildManifest({ baseUrl: 'https://orb.example.com', docsUrl: manifest.links.docs }))));
    expect(manifest).toMatchObject({ protocol: 'cp1', service: 'orb', tenantKind: 'organization' });

    for (const action of manifest.actions) {
      expect(action.inputSchema).toEqual(toJsonSchema(ACTIONS[action.name as keyof typeof ACTIONS].input, 'input'));
      const dispatchable = action.name in HANDLERS || action.async;
      expect(dispatchable, action.name).toBe(true);
    }
    const root = path.resolve(__dirname, '../../app/api/connect/v1');
    for (const resource of Object.values(RESOURCES)) {
      const file = path.join(root, ...resource.path.split('/').filter(Boolean).map((s) => s.replace(/^\{(.+)\}$/, '[$1]')), 'route.ts');
      expect(fs.existsSync(file), `${resource.name} -> ${file}`).toBe(true);
    }
    for (const required of ['/api/connect/v1/health', '/api/connect/v1/me', '/api/connect/v1/openapi.json', '/api/connect/v1/events', '/api/connect/v1/webhooks', '/api/connect/v1/operations/[id]', '/api/connect/v1/actions/[name]']) {
      expect(fs.existsSync(path.resolve(__dirname, '../../app', required.replace('/api/', 'api/').replace(/^\//, ''), 'route.ts')), required).toBe(true);
    }
  });
});

describe('C02-C06 OAuth', () => {
  const issue = async () => {
    const { verifier, challenge } = pkce();
    const res = await postDecision(h, userA, { ...authorizeQuery({ scope: 'orb:projects:read', state: 's', challenge }), org_id: orgA.id, decision: 'allow' });
    return { code: new URL(res.headers.get('location')!).searchParams.get('code')!, verifier };
  };
  const exchange = (code: string, verifier: string, redirect = REDIRECT_URI) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });

  it('C02 PKCE is required and a wrong verifier fails', async () => {
    expect(validateAuthorizeRequest({ ...authorizeQuery({ scope: 'orb:projects:read', state: 's', challenge: pkce().challenge }), code_challenge: '' })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(validateAuthorizeRequest(authorizeQuery({ scope: 'orb:projects:read', state: 's', challenge: pkce().challenge, method: 'plain' }))).toMatchObject({ ok: false });
    const { code, verifier } = await issue();
    expect((await exchange(code, `${verifier}x`)).status).toBe(400);
  });

  it('C03 a code is single use; a second use revokes what the first issued', async () => {
    const { code, verifier } = await issue();
    const first = await (await exchange(code, verifier)).json();
    expect((await exchange(code, verifier)).status).toBe(400);
    expect((await http(meRoute, 'GET', '/me', first.access_token)).status).toBe(401);
  });

  it('C04 redirect_uri must match exactly', async () => {
    for (const bad of ['https://hub.example.com/callback/', 'https://hub.example.com/other', 'http://hub.example.com/callback']) {
      expect(validateAuthorizeRequest(authorizeQuery({ scope: 'orb:projects:read', state: 's', challenge: pkce().challenge, redirectUri: bad })), bad).toMatchObject({ ok: false, display: 'page' });
    }
    const { code, verifier } = await issue();
    expect((await exchange(code, verifier, 'http://localhost:3100/callback')).status).toBe(400);
  });

  it('C05 refresh tokens rotate and a rotated one is theft', async () => {
    const c = await connect(h, userA, orgA.id, 'orb:projects:read');
    const next = await (await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh })).json();
    expect(next.refresh_token).not.toBe(c.refresh);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh })).status).toBe(400);
    expect((await http(meRoute, 'GET', '/me', next.access_token)).status).toBe(401);
  });

  it('C06 revocation works immediately', async () => {
    const c = await connect(h, userA, orgA.id, 'orb:projects:read');
    const { POST } = await import('@/app/api/connect/v1/oauth/revoke/route');
    const res = await POST(new Request('https://orb.example.com/x', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.access }).toString() }));
    expect(res.status).toBe(200);
    expect((await http(meRoute, 'GET', '/me', c.access)).status).toBe(401);
  });
});

describe('C07-C09 authorization at request time', () => {
  it('C07 every endpoint enforces its scope', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const only = (scope: string) => connect(h, userA, orgA.id, scope).then((c) => c.access);
    const cases: Array<[unknown, string, string, string, Record<string, string>, unknown?]> = [
      [R.projectsList, 'GET', '/projects', 'orb:projects:read', {}],
      [R.deploymentsGet, 'GET', '/deployments/x', 'orb:deployments:read', { id: project.id }],
      [R.githubRepos, 'GET', '/github/repos', 'orb:github:read', {}],
      [eventsList, 'GET', '/events', 'orb:events:read', {}],
      [webhooksList, 'GET', '/webhooks', 'orb:webhooks:manage', {}],
      [actionRoute, 'POST', '/actions/env.remove', 'orb:env:write', { name: 'env.remove' }, { input: { projectId: project.id, key: 'A' } }],
    ];
    for (const [handler, method, p, scope, params, body] of cases) {
      // orb:events:read is always granted together with orb:webhooks:manage, so drop both when testing the event log
      const dropped = scope === 'orb:events:read' ? ['orb:events:read', 'orb:webhooks:manage'] : [scope];
      const without = await only(CONNECTOR_SCOPE_NAMES.filter((s) => !dropped.includes(s)).join(' '));
      const denied = await http(handler, method, p, without, body, params);
      expect(denied.status, p).toBe(403);
      expect((await denied.json()).error).toMatchObject({ code: 'insufficient_scope', requiredScope: scope });
    }
  });

  it('C08 ids of another tenant are 404, never 403', async () => {
    const theirs = await seedProject(h, orgB.id, userB.id, { repo: 'acme/site' });
    const deployment = await seedDeployment(h, theirs.id);
    expect((await http(R.projectsGet, 'GET', '/projects/x', tokenA, undefined, { id: theirs.id })).status).toBe(404);
    expect((await http(R.deploymentsGet, 'GET', '/deployments/x', tokenA, undefined, { id: deployment.id })).status).toBe(404);
    expect((await act('deployments.trigger', { projectId: theirs.id })).status).toBe(404);
    expect((await act('env.set', { projectId: theirs.id, vars: [{ key: 'A', value: '1' }] })).status).toBe(404);
  });

  it('C09 a role downgrade takes effect on the next call', async () => {
    const admin = await seedUser(h);
    await setRole(h, orgA.id, admin.id, 'admin');
    const token = (await connect(h, admin, orgA.id, 'orb:projects:read orb:domains:write')).access;
    const project = await seedProject(h, orgA.id, userA.id);
    expect((await act('domains.add', { projectId: project.id, domain: 'one.example.com' }, token)).status).toBe(200);
    await setRole(h, orgA.id, admin.id, 'viewer');
    expect((await act('domains.add', { projectId: project.id, domain: 'two.example.com' }, token)).status).toBe(403);
    expect((await http(meRoute, 'GET', '/me', token)).status).toBe(200);
  });
});

describe('C10 idempotency', () => {
  it('replays the same request and rejects a different one under the same key', async () => {
    const body = { name: 'Idem', type: 'static', repository: { fullName: 'acme/site' }, deploy: false };
    const first = await act('projects.create', body, tokenA, { 'idempotency-key': 'k1' });
    const again = await act('projects.create', body, tokenA, { 'idempotency-key': 'k1' });
    expect(again.headers.get('idempotent-replay')).toBe('true');
    expect(await again.json()).toEqual(await first.json());
    const other = await act('projects.create', { ...body, name: 'Other' }, tokenA, { 'idempotency-key': 'k1' });
    expect(other.status).toBe(422);
    expect((await other.json()).error.code).toBe('idempotency_conflict');
    expect(await h.db.select().from(schema.projects)).toHaveLength(1);
  });
});

describe('C11 error shape on every failure path', () => {
  it('is always JSON { error: { code, message, retryable, requestId } } with the request id in the header', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const failures: Array<[string, Response]> = [
      ['401 no token', await http(meRoute, 'GET', '/me')],
      ['401 bad token', await http(meRoute, 'GET', '/me', 'cp1_orb_bad')],
      ['403 scope', await http(R.githubRepos, 'GET', '/github/repos', (await connect(h, userA, orgA.id, 'orb:projects:read')).access)],
      ['403 team', await http(meRoute, 'GET', '/me', tokenA, undefined, {}, { 'x-orb-org': orgB.id })],
      ['404 id', await http(R.projectsGet, 'GET', '/projects/x', tokenA, undefined, { id: 'nope' })],
      ['404 action', await act('nothing.here', {})],
      ['400 body', await act('env.remove', { surprise: true })],
      ['400 query', await http(R.projectsList, 'GET', '/projects?limit=999', tokenA)],
      ['402 plan', await (async () => {
        await h.db.update(schema.organizations).set({ plan: 'free' }).where(eq(schema.organizations.id, orgA.id));
        for (let i = 0; i < 5; i++) await seedProject(h, orgA.id, userA.id, { name: `P${i}` });
        return act('projects.create', { name: 'x2', type: 'static', repository: { fullName: 'acme/site' }, deploy: false });
      })()],
      ['409 conflict', await act('deployments.cancel', { deploymentId: (await seedDeployment(h, project.id, { status: 'READY' })).id })],
      ['412 github', await act('projects.create', { name: 'x3', type: 'static', repository: { fullName: 'acme/site' } }, tokenB)],
      ['413 size', await http(actionRoute, 'POST', '/actions/env.set', tokenA, { input: { projectId: project.id, dotenv: 'A='.padEnd(1_100_000, 'x') } }, { name: 'env.set' })],
      ['422 idempotency', await (async () => {
        await act('env.remove', { projectId: project.id, key: 'A' }, tokenA, { 'idempotency-key': 'c11' });
        return act('env.remove', { projectId: project.id, key: 'B' }, tokenA, { 'idempotency-key': 'c11' });
      })()],
    ];
    const seen = new Set<number>();
    for (const [label, res] of failures) {
      expect(res.headers.get('content-type'), label).toBe('application/json; charset=utf-8');
      const body = await res.json();
      expect(Object.keys(body), label).toEqual(['error']);
      expect(body.error, label).toMatchObject({ code: expect.any(String), message: expect.any(String), retryable: expect.any(Boolean), requestId: res.headers.get('x-request-id') });
      expect(body.error.retryable, label).toBe(false);
      seen.add(res.status);
    }
    expect([...seen].sort()).toEqual([400, 401, 402, 403, 404, 409, 412, 413, 422]);
  });
});

describe('C12 pagination', () => {
  it('uses ?limit= (default 50, max 200) and opaque cursors with { items, nextCursor }', async () => {
    for (let i = 0; i < 5; i++) await seedProject(h, orgA.id, userA.id, { name: `P${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
    const page = await (await http(R.projectsList, 'GET', '/projects?limit=2', tokenA)).json();
    expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor']);
    expect(page.items).toHaveLength(2);
    expect(typeof page.nextCursor).toBe('string');
    const rest = await (await http(R.projectsList, 'GET', `/projects?limit=200&cursor=${page.nextCursor}`, tokenA)).json();
    expect(rest.items).toHaveLength(3);
    expect(rest.nextCursor).toBeNull();
    expect((await http(R.projectsList, 'GET', '/projects?limit=201', tokenA)).status).toBe(400);
  });
});

describe('C13 rate limit headers and 429', () => {
  it('sends X-RateLimit-* and Retry-After', async () => {
    const res = await http(meRoute, 'GET', '/me', tokenA);
    expect(res.headers.get('x-ratelimit-limit')).toBe('120');
    expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy();
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
    const key = `orb:rl:cp1:grant:${grantA}:${Math.floor(Date.now() / 1000 / 60)}`;
    for (let i = 0; i < 120; i++) await h.redis.incr(key);
    const limited = await http(meRoute, 'GET', '/me', tokenA);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect((await limited.json()).error).toMatchObject({ code: 'rate_limited', retryable: true });
  });
});

describe('C14 async actions', () => {
  it('answers 202 with an operation that reaches a terminal state', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const deployment = await seedDeployment(h, project.id, { status: 'BUILDING' });
    const res = await act('projects.waitForDeployment', { deploymentId: deployment.id });
    expect(res.status).toBe(202);
    const { operation } = await res.json();
    expect(operation).toMatchObject({ status: 'pending', pollUrl: expect.stringContaining(operation.id) });
    await h.db.update(schema.deployments).set({ status: 'READY' }).where(eq(schema.deployments.id, deployment.id));
    const done = await (await http(operationRoute, 'GET', `/operations/${operation.id}`, tokenA, undefined, { id: operation.id })).json();
    expect(done).toMatchObject({ id: operation.id, action: 'projects.waitForDeployment', status: 'succeeded', output: { deployment: { status: 'READY' } } });
    expect(done.finishedAt).toBeTruthy();
  });
});

describe('C15-C17 webhooks', () => {
  it('C15 returns the secret once; deliveries are signed and carry a timestamp', async () => {
    const receiver = await startReceiver();
    try {
      const created = await (await http(webhooksCreate, 'POST', '/webhooks', tokenA, { url: receiver.url, events: ['project.*'] })).json();
      expect(created.secret).toMatch(/^whsec_/);
      expect(await (await http(webhooksGet, 'GET', `/webhooks/${created.id}`, tokenA, undefined, { id: created.id })).text()).not.toContain(created.secret);
      await createSite();
      await runConnectorDispatch(h.db as never, { policy: DEV });
      const [request] = receiver.received;
      expect(request).toBeTruthy();
      const timestamp = String(request!.headers['x-cp-timestamp']);
      expect(timestamp).toMatch(/^\d{10}$/);
      expect(verifyWebhookSignature(created.secret, timestamp, request!.body, String(request!.headers['x-cp-signature']))).toBe(true);
    } finally {
      await receiver.close();
    }
  });

  it('C16 retries with back-off and a 410 disables the endpoint', async () => {
    const { id } = await (await http(webhooksCreate, 'POST', '/webhooks', tokenA, { url: 'http://127.0.0.1:9/h', events: ['*'] })).json();
    await emitConnectorEvent(h.db as never, { orgId: orgA.id, type: 'project.created', data: {}, actor: { kind: 'system' } });
    await fanOutEvents(h.db as never);
    const failing = (status: number) => async () => ({ status, excerpt: '' });
    await deliverDue(h.db as never, { policy: DEV, post: failing(500) as never });
    const [delivery] = await h.db.select().from(schema.connectorDeliveries).where(eq(schema.connectorDeliveries.webhookId, id));
    expect(delivery).toMatchObject({ status: 'failed', attempt: 1 });
    expect(delivery!.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(7_000);
    expect(delivery!.nextAttemptAt!.getTime() - Date.now()).toBeLessThan(13_000);
    await h.db.update(schema.connectorDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.connectorDeliveries.id, delivery!.id));
    await deliverDue(h.db as never, { policy: DEV, post: failing(410) as never });
    const [hook] = await h.db.select().from(schema.connectorWebhooks).where(eq(schema.connectorWebhooks.id, id));
    expect(hook).toMatchObject({ status: 'disabled', disabledReason: 'endpoint_gone' });
    expect((await (await http(webhooksGet, 'GET', `/webhooks/${id}`, tokenA, undefined, { id })).json())).toMatchObject({ status: 'disabled', disabledReason: 'endpoint_gone' });
  });

  it('C17 rejects private, loopback, link-local and metadata URLs', async () => {
    vi.stubEnv('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', 'false');
    for (const url of ['https://127.0.0.1/x', 'https://10.0.0.1/x', 'https://192.168.1.1/x', 'https://169.254.169.254/x', 'https://[::1]/x', 'http://example.com/x']) {
      const res = await http(webhooksCreate, 'POST', '/webhooks', tokenA, { url, events: ['*'] });
      expect(res.status, url).toBe(400);
    }
  });
});

describe('C18-C20 events', () => {
  it('C18 echoes externalRef from the creating action into the events of the entity and its children', async () => {
    const project = (await createSite({ externalRef: { hubProjectId: 'hp', hubRunId: 'run', hubStepId: 'step' } })).project;
    await ok('deployments.trigger', { projectId: project.id });
    const events = (await h.db.select().from(schema.connectorEvents).where(eq(schema.connectorEvents.orgId, orgA.id))).map((e) => e.payload as { type: string; externalRef: unknown });
    expect(events.map((e) => e.type)).toEqual(['project.created', 'deployment.queued']);
    for (const e of events) expect(e.externalRef).toEqual({ hubProjectId: 'hp', hubRunId: 'run', hubStepId: 'step' });
  });

  it('C19 an event exists if and only if the change committed', async () => {
    await expect(
      withOutbox(h.db as never, async (tx) => {
        const [p] = await (tx as unknown as typeof h.db).insert(schema.projects).values({ name: 'X', slug: 'x-1', userId: userA.id, orgId: orgA.id, type: 'static' }).returning();
        await emitProjectEvent(tx, p!, null, 'created', { kind: 'system' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await h.db.select().from(schema.connectorEvents)).toHaveLength(0);
    expect(await h.db.select().from(schema.projects)).toHaveLength(0);
    await createSite();
    expect(await h.db.select().from(schema.connectorEvents)).toHaveLength(1);
  });

  it('C20 GET /events replays what the webhooks delivered', async () => {
    const receiver = await startReceiver();
    try {
      await http(webhooksCreate, 'POST', '/webhooks', tokenA, { url: receiver.url, events: ['*'] });
      const project = (await createSite()).project;
      await ok('env.set', { projectId: project.id, vars: [{ key: 'A', value: '1' }] });
      await runConnectorDispatch(h.db as never, { policy: DEV });
      const delivered = receiver.received.map((r) => JSON.parse(r.body));
      const log = (await (await http(eventsList, 'GET', '/events', tokenA)).json()).items;
      expect(delivered.length).toBeGreaterThanOrEqual(2);
      expect(log).toEqual(delivered);
    } finally {
      await receiver.close();
    }
  });
});

describe('C21 no secret material in any response', () => {
  it('never returns tokens, client secrets, keys, ciphertext, env values or webhook secrets after creation', async () => {
    const connected = await connect(h, userA, orgA.id, ALL);
    await h.db.insert(schema.accounts).values({ id: 'gh-extra', accountId: 'x', providerId: 'github-extra', userId: userA.id, accessToken: 'gho_THIS_MUST_NOT_LEAK' });
    const project = (await createSite()).project;
    await ok('env.set', { projectId: project.id, vars: [{ key: 'DB_PASSWORD', value: 'hunter2-very-secret', sensitive: true }, { key: 'PUBLIC', value: 'visible', sensitive: false }] });
    const hook = await (await http(webhooksCreate, 'POST', '/webhooks', tokenA, { url: 'http://127.0.0.1:9/h', events: ['*'] })).json();
    await emitConnectorEvent(h.db as never, { orgId: orgA.id, type: 'project.updated', data: {}, actor: { kind: 'system' } });
    await runConnectorDispatch(h.db as never, { policy: DEV, post: (async () => ({ status: 200, excerpt: 'ok' })) as never });

    const texts: string[] = [];
    const collect = async (res: Response) => texts.push(await res.text());
    await collect(await http(meRoute, 'GET', '/me', connected.access));
    await collect(await http(manifestRoute, 'GET', '/manifest'));
    await collect(await http(R.projectsList, 'GET', '/projects', tokenA));
    await collect(await http(R.projectsGet, 'GET', '/projects/x', tokenA, undefined, { id: project.id }));
    await collect(await http(R.projectEnv, 'GET', '/projects/x/env', tokenA, undefined, { id: project.id }));
    await collect(await http(R.githubRepos, 'GET', '/github/repos', tokenA));
    await collect(await http(R.usageGet, 'GET', '/usage', tokenA));
    await collect(await http(webhooksList, 'GET', '/webhooks', tokenA));
    await collect(await http(webhooksGet, 'GET', `/webhooks/${hook.id}`, tokenA, undefined, { id: hook.id }));
    await collect(await http(eventsList, 'GET', '/events', tokenA));
    await collect(await act('env.set', { projectId: project.id, vars: [{ key: 'X', value: 'hunter2-very-secret' }] }));
    await collect(await act('projects.update', { projectId: project.id, name: 'Renamed' }));
    await collect(await act('domains.add', { projectId: project.id, domain: 'leak.example.com' }));
    await collect(await http(R.deploymentsGet, 'GET', '/d', tokenA, undefined, { id: (await seedDeployment(h, project.id)).id }));

    const forbidden = [
      connected.access, connected.refresh, tokenA, HUB_ENV.CONNECTOR_HUB_CLIENT_SECRET, HUB_ENV.CONNECTOR_TOKEN_PEPPER, HUB_ENV.CONNECTOR_ENCRYPTION_KEY, HUB_ENV.ENCRYPTION_KEY,
      'enc:v1:', 'hunter2-very-secret', 'gho_THIS_MUST_NOT_LEAK', `gho_${userA.id}`, hook.secret, 'secretEnc', 'verificationToken', 'accessHash', 'refreshHash', 'passwordHash',
    ];
    for (const text of texts) for (const secret of forbidden) expect(text.includes(secret), `leaked ${secret.slice(0, 12)}…`).toBe(false);
    expect(texts.join('')).toContain('visible'); // non-sensitive values are shown
  });
});

describe('C22 feature flag off', () => {
  it('answers 404 on every connector route', async () => {
    vi.stubEnv('CONNECTOR_ENABLED', 'false');
    const files = fs
      .readdirSync(path.resolve(__dirname, '../../app/api/connect'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('route.ts'))
      .map((f) => f.replace(/\\/g, '/'));
    expect(files.length).toBeGreaterThanOrEqual(25);
    for (const file of files) {
      const mod = (await import(/* @vite-ignore */ `../../app/api/connect/${file}`)) as Record<string, unknown>;
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const handler = mod[method];
        if (typeof handler !== 'function') continue;
        const res = await (handler as Route)(new Request('https://orb.example.com/x', { method, headers: { authorization: `Bearer ${tokenA}` } }), { params: Promise.resolve({ id: 'x', name: 'x', deliveryId: 'x' }) });
        expect(res.status, `${method} ${file}`).toBe(404);
        expect((await res.json()).error.code).toBe('not_found');
      }
    }
    const wellKnown = await import('@/app/.well-known/ecosystem-connector.json/route');
    expect((await wellKnown.GET(new Request('https://orb.example.com/.well-known/ecosystem-connector.json'))).status).toBe(404);
    expect((await postDecision(h, userA, { ...authorizeQuery({ scope: 'orb:projects:read', state: 's', challenge: pkce().challenge }), org_id: orgA.id, decision: 'allow' })).status).toBe(404);
    expect(CLIENT_ID).toBe('test-hub');
    expect(and).toBeTypeOf('function');
  });
});
