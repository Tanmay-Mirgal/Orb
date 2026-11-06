import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from 'database/src/schema';

vi.mock('@/lib/db', async () => (await import('./testing/harness')).dbModule());
vi.mock('@/lib/auth', async () => (await import('./testing/harness')).authModule());
vi.mock('@/server/infra', async () => (await import('./testing/harness')).infraModule());
vi.mock('core', async (importOriginal) => (await import('./testing/harness')).coreOverrides(await importOriginal()));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { RETRY_DELAYS_SECONDS, decryptConnectorSecret, verifyWebhookSignature, type WebhookUrlPolicy } from 'core';
import { deliverDue, emitConnectorEvent, fanOutEvents, runConnectorDispatch, runConnectorRetention } from 'database';
import { CONNECTOR_SCOPE_NAMES, eventEnvelopeSchema } from 'shared';
import { actionRoute } from './dispatch';
import { eventsList, webhookDeliveries, webhookRedeliver, webhooksCreate, webhooksDelete, webhooksGet, webhooksList, webhooksPatch } from './webhooks';
import { HUB_ENV, RESET_SQL, harness, linkGithub, seedOrg, seedUser, type Harness, type TestUser } from './testing/harness';
import { startReceiver } from './testing/receiver';
import { connect } from './testing/flow';

let h: Harness;
let userA: TestUser;
let userB: TestUser;
let orgA: Awaited<ReturnType<typeof seedOrg>>;
let orgB: Awaited<ReturnType<typeof seedOrg>>;
let tokenA: string;
let tokenB: string;
let grantA: string;

const ALL = CONNECTOR_SCOPE_NAMES.join(' ');
const DEV: WebhookUrlPolicy = { production: false, allowPrivate: true };
const REPO = { id: 11, full_name: 'acme/site', default_branch: 'main', files: { 'index.html': '<h1>hello</h1>' } };

type Route = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, method: string, token: string, path: string, params: Record<string, string> = {}, body?: unknown): Promise<Response> {
  const run = handler as Route;
  return run(
    new Request(`https://orb.example.com/api/connect/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
}

const register = (url: string, events: string[] = ['*'], token = tokenA) => call(webhooksCreate, 'POST', token, '/webhooks', {}, { url, events });

async function registered(url: string, events: string[] = ['*'], token = tokenA) {
  const res = await register(url, events, token);
  const body = await res.json();
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(body)}`);
  return body as { id: string; secret: string; url: string; events: string[]; status: string };
}

async function act(name: string, input: unknown, token = tokenA) {
  const res = await (actionRoute as unknown as Route)(
    new Request(`https://orb.example.com/api/connect/v1/actions/${name}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ input }) }),
    { params: Promise.resolve({ name }) },
  );
  const body = await res.json();
  if (res.status >= 300) throw new Error(`${name} failed: ${res.status} ${JSON.stringify(body)}`);
  return body.output;
}

const emit = (type: string, data: Record<string, unknown> = {}) => emitConnectorEvent(h.db as never, { orgId: orgA.id, type, data, actor: { kind: 'system' } });
const deliveriesOf = (webhookId: string) => h.db.select().from(schema.connectorDeliveries).where(eq(schema.connectorDeliveries.webhookId, webhookId)).orderBy(asc(schema.connectorDeliveries.createdAt));
const webhookRow = async (id: string) => (await h.db.select().from(schema.connectorWebhooks).where(eq(schema.connectorWebhooks.id, id)))[0]!;

beforeAll(async () => {
  for (const [k, v] of Object.entries(HUB_ENV)) vi.stubEnv(k, v);
  h = await harness();
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', 'true');
  h.redis.flush();
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
afterEach(() => vi.stubEnv('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', 'true'));

describe('endpoint registration (C15)', () => {
  it('returns the signing secret once and stores it encrypted', async () => {
    const created = await registered('http://127.0.0.1:9/hook', ['deployment.*', 'project.created']);
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43,}$/);
    expect(created).toMatchObject({ url: 'http://127.0.0.1:9/hook', events: ['deployment.*', 'project.created'], status: 'active' });

    const row = await webhookRow(created.id);
    expect(row.secretEnc.startsWith('enc:v1:')).toBe(true);
    expect(row.secretEnc).not.toContain(created.secret);
    expect(decryptConnectorSecret(row.secretEnc, row.id)).toBe(created.secret);
    expect(row).toMatchObject({ grantId: grantA, orgId: orgA.id, consecutiveFailures: 0 });

    for (const res of [await call(webhooksGet, 'GET', tokenA, `/webhooks/${created.id}`, { id: created.id }), await call(webhooksList, 'GET', tokenA, '/webhooks')]) {
      expect(await res.text()).not.toMatch(/whsec_|secret/i);
    }
  });

  it('needs orb:webhooks:manage', async () => {
    const { access } = await connect(h, userA, orgA.id, 'orb:projects:read orb:events:read');
    const res = await register('http://127.0.0.1:9/x', ['*'], access);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({ code: 'insufficient_scope', requiredScope: 'orb:webhooks:manage' });
  });

  it('limits a grant to 5 endpoints', async () => {
    for (let i = 0; i < 5; i++) await registered(`http://127.0.0.1:9/h${i}`);
    const sixth = await register('http://127.0.0.1:9/h5');
    expect(sixth.status).toBe(409);
    expect((await sixth.json()).error.code).toBe('conflict');
    const first = (await (await call(webhooksList, 'GET', tokenA, '/webhooks')).json()).items[0];
    expect((await call(webhooksDelete, 'DELETE', tokenA, `/webhooks/${first.id}`, { id: first.id })).status).toBe(200);
    expect((await register('http://127.0.0.1:9/h5')).status).toBe(201);
  });

  it('validates event filters and rejects unknown fields', async () => {
    const bad = await register('http://127.0.0.1:9/x', ['deployment.exploded', 'nope.*']);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details.map((d: { path: string }) => d.path)).toEqual(['events.0', 'events.1']);
    expect((await call(webhooksCreate, 'POST', tokenA, '/webhooks', {}, { url: 'http://127.0.0.1:9/x', events: ['*'], secret: 'mine' })).status).toBe(400);
    expect((await call(webhooksCreate, 'POST', tokenA, '/webhooks', {}, { url: 'http://127.0.0.1:9/x', events: [] })).status).toBe(400);
  });

  it('keeps endpoints private to their grant (another grant, another team: 404)', async () => {
    const created = await registered('http://127.0.0.1:9/mine');
    const sibling = (await connect(h, userA, orgA.id, ALL)).access;
    for (const token of [sibling, tokenB]) {
      for (const [handler, method] of [[webhooksGet, 'GET'], [webhooksPatch, 'PATCH'], [webhooksDelete, 'DELETE'], [webhookDeliveries, 'GET']] as const) {
        const res = await call(handler, method, token, `/webhooks/${created.id}`, { id: created.id }, method === 'PATCH' ? { description: 'x' } : undefined);
        expect(res.status, `${method}`).toBe(404);
      }
    }
    expect((await (await call(webhooksList, 'GET', sibling, '/webhooks')).json()).items).toEqual([]);
  });

  it('updates, disables and re-enables an endpoint (re-enabling resets the failure counters)', async () => {
    const created = await registered('http://127.0.0.1:9/hook', ['*']);
    const patched = await (await call(webhooksPatch, 'PATCH', tokenA, '/', { id: created.id }, { events: ['domain.*'], description: 'only domains' })).json();
    expect(patched).toMatchObject({ events: ['domain.*'], description: 'only domains', status: 'active' });
    const off = await (await call(webhooksPatch, 'PATCH', tokenA, '/', { id: created.id }, { status: 'disabled' })).json();
    expect(off).toMatchObject({ status: 'disabled', disabledReason: 'manual' });
    await h.db.update(schema.connectorWebhooks).set({ consecutiveFailures: 49, failingSince: new Date(Date.now() - 86_400_000) }).where(eq(schema.connectorWebhooks.id, created.id));
    const on = await (await call(webhooksPatch, 'PATCH', tokenA, '/', { id: created.id }, { status: 'active' })).json();
    expect(on).toMatchObject({ status: 'active', disabledReason: null, consecutiveFailures: 0 });
    expect((await webhookRow(created.id)).failingSince).toBeNull();
  });

  it('removes an endpoint with its deliveries', async () => {
    const created = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    expect(await deliveriesOf(created.id)).toHaveLength(1);
    expect((await call(webhooksDelete, 'DELETE', tokenA, '/', { id: created.id })).status).toBe(200);
    expect(await h.db.select().from(schema.connectorDeliveries)).toHaveLength(0);
  });
});

describe('SSRF protection on registration (C17)', () => {
  it.each([
    'http://hooks.example.com/x',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://169.254.169.254/latest/meta-data',
    'https://10.1.2.3/x',
    'https://192.168.0.5/x',
    'https://172.16.0.9/x',
    'https://[::1]/x',
    'https://[fd00:ec2::254]/x',
    'https://metadata.internal/x',
    'https://user:pw@example.com/x',
  ])('rejects %s', async (url) => {
    vi.stubEnv('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', 'false');
    const res = await register(url);
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatchObject({ code: 'validation_failed', retryable: false });
    expect(error.details[0].path).toBe('url');
    expect(await h.db.select().from(schema.connectorWebhooks)).toHaveLength(0);
  });

  it('applies the same rules when an endpoint is edited', async () => {
    const created = await registered('http://127.0.0.1:9/hook');
    vi.stubEnv('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', 'false');
    const res = await call(webhooksPatch, 'PATCH', tokenA, '/', { id: created.id }, { url: 'https://10.0.0.1/x' });
    expect(res.status).toBe(400);
    expect((await webhookRow(created.id)).url).toBe('http://127.0.0.1:9/hook');
  });
});

describe('delivery (C15, C18, C20)', () => {
  it('delivers signed events with the documented headers, the same envelopes that GET /events returns', async () => {
    const receiver = await startReceiver();
    try {
      const hook = await registered(receiver.url, ['deployment.*', 'project.created']);
      const out = await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, externalRef: { hubProjectId: 'hp_1', hubRunId: 'run_1' } });
      await act('env.set', { projectId: out.project.id, vars: [{ key: 'A', value: '1' }] }); // env.updated is not subscribed

      const result = await runConnectorDispatch(h.db as never, { policy: DEV });
      expect(result.fanout).toMatchObject({ events: 3, deliveries: 2 });
      expect(result.delivery).toMatchObject({ succeeded: 2, retried: 0, abandoned: 0 });

      expect(receiver.received).toHaveLength(2);
      const seen = [];
      for (const request of receiver.received) {
        const { headers, body } = request;
        const event = JSON.parse(body);
        seen.push(event);
        expect(eventEnvelopeSchema.safeParse(event).success).toBe(true);
        expect(headers['x-cp-event']).toBe(event.type);
        expect(headers['x-cp-delivery']).toMatch(/^[0-9a-f-]{36}$/);
        expect(headers['user-agent']).toBe('Orb-Connector/1.0');
        expect(headers['content-type']).toContain('application/json');
        const timestamp = String(headers['x-cp-timestamp']);
        expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(30);
        // the signature covers "<timestamp>.<raw body>" and verifies with the secret returned at registration
        expect(headers['x-cp-signature']).toMatch(/^v1=[0-9a-f]{64}$/);
        expect(verifyWebhookSignature(hook.secret, timestamp, body, String(headers['x-cp-signature']))).toBe(true);
        expect(verifyWebhookSignature(hook.secret, timestamp, `${body} `, String(headers['x-cp-signature']))).toBe(false);
        expect(verifyWebhookSignature('whsec_wrong', timestamp, body, String(headers['x-cp-signature']))).toBe(false);
        expect(event.externalRef).toMatchObject({ hubProjectId: 'hp_1', hubRunId: 'run_1' });
      }
      expect(seen.map((e) => e.type)).toEqual(['project.created', 'deployment.queued']);

      // the polling fallback replays exactly what the webhook delivered
      const log = await (await call(eventsList, 'GET', tokenA, '/events')).json();
      const delivered = new Set(seen.map((e) => e.id));
      expect(log.items.filter((e: { id: string }) => delivered.has(e.id))).toEqual(seen);

      const row = await webhookRow(hook.id);
      expect(row).toMatchObject({ consecutiveFailures: 0, lastDeliveryStatus: 'succeeded', lastResponseCode: 200, failingSince: null });
      const deliveries = await (await call(webhookDeliveries, 'GET', tokenA, '/', { id: hook.id })).json();
      expect(deliveries.items).toHaveLength(2);
      expect(deliveries.items[0]).toMatchObject({ status: 'succeeded', attempts: 1, responseCode: 200, responseExcerpt: 'ok', lastError: null });
      expect(deliveries.items.map((d: { eventType: string }) => d.eventType).sort()).toEqual(['deployment.queued', 'project.created']);
    } finally {
      await receiver.close();
    }
  });

  it('filters before queueing: an endpoint never gets a delivery row for events it did not ask for', async () => {
    const hook = await registered('http://127.0.0.1:9/hook', ['domain.*']);
    await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' } });
    const { fanout } = await runConnectorDispatch(h.db as never, { policy: DEV, post: async () => ({ status: 200, excerpt: '' }) });
    expect(fanout).toEqual({ events: 2, deliveries: 0 });
    expect(await deliveriesOf(hook.id)).toHaveLength(0);
  });

  it('only delivers what the grant may read, and nothing from another team', async () => {
    const limited = (await connect(h, userA, orgA.id, 'orb:webhooks:manage orb:projects:read')).access;
    const hook = await registered('http://127.0.0.1:9/hook', ['*'], limited);
    await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' } });
    await emitConnectorEvent(h.db as never, { orgId: orgB.id, type: 'project.created', data: {}, actor: { kind: 'system' } });
    await fanOutEvents(h.db as never);
    const types = await Promise.all((await deliveriesOf(hook.id)).map(async (d) => (await h.db.select().from(schema.connectorEvents).where(eq(schema.connectorEvents.id, d.eventId)))[0]!.type));
    expect(types.sort()).toEqual(['project.created']); // deployment.queued needs orb:deployments:read; orgB's event is not ours
  });

  it('stops queueing deliveries once the user who connected the app left the team', async () => {
    const member = await seedUser(h);
    await h.db.insert(schema.memberships).values({ orgId: orgA.id, userId: member.id, role: 'member' });
    const token = (await connect(h, member, orgA.id, 'orb:webhooks:manage orb:projects:read')).access;
    const hook = await registered('http://127.0.0.1:9/hook', ['project.*'], token);
    await emit('project.created');
    await fanOutEvents(h.db as never);
    expect(await deliveriesOf(hook.id)).toHaveLength(1);
    await h.db.delete(schema.memberships).where(eq(schema.memberships.userId, member.id));
    await emit('project.updated');
    expect((await fanOutEvents(h.db as never)).deliveries).toBe(0);
    expect(await deliveriesOf(hook.id)).toHaveLength(1);
  });

  it('replays a delivery on request with the same delivery id, and refuses when it makes no sense', async () => {
    const receiver = await startReceiver();
    try {
      const hook = await registered(receiver.url, ['project.created']);
      await emit('project.created', { project: { id: 'p1' } });
      await runConnectorDispatch(h.db as never, { policy: DEV });
      const [delivery] = await deliveriesOf(hook.id);
      expect(receiver.received).toHaveLength(1);

      const res = await call(webhookRedeliver, 'POST', tokenA, '/', { id: hook.id, deliveryId: delivery!.id });
      expect(res.status).toBe(202);
      await runConnectorDispatch(h.db as never, { policy: DEV });
      expect(receiver.received).toHaveLength(2);
      expect(receiver.received[1]!.headers['x-cp-delivery']).toBe(receiver.received[0]!.headers['x-cp-delivery']);
      expect(JSON.parse(receiver.received[1]!.body).id).toBe(JSON.parse(receiver.received[0]!.body).id);

      await h.db.update(schema.connectorDeliveries).set({ status: 'delivering' }).where(eq(schema.connectorDeliveries.id, delivery!.id));
      expect((await call(webhookRedeliver, 'POST', tokenA, '/', { id: hook.id, deliveryId: delivery!.id })).status).toBe(409);
      expect((await call(webhookRedeliver, 'POST', tokenA, '/', { id: hook.id, deliveryId: '3f6c7a0e-5f0b-4d0e-9c9e-2f4d9b1a7c11' })).status).toBe(404);
      expect((await call(webhookRedeliver, 'POST', tokenB, '/', { id: hook.id, deliveryId: delivery!.id })).status).toBe(404);
      await h.db.update(schema.connectorWebhooks).set({ status: 'disabled', disabledReason: 'manual' }).where(eq(schema.connectorWebhooks.id, hook.id));
      await h.db.update(schema.connectorDeliveries).set({ status: 'succeeded' }).where(eq(schema.connectorDeliveries.id, delivery!.id));
      expect((await call(webhookRedeliver, 'POST', tokenA, '/', { id: hook.id, deliveryId: delivery!.id })).status).toBe(409);
    } finally {
      await receiver.close();
    }
  });
});

describe('retries, back-off and disabling (C16)', () => {
  const failing = (status = 500) => async () => ({ status, excerpt: 'boom' });

  it('retries on 10 s, 30 s, 2 m, 10 m, 30 m, 1 h, 3 h, 6 h (±20 %), then gives up after 9 attempts', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    let now = new Date('2026-06-01T10:00:00Z');
    const clock = () => now;
    const seen: Array<{ delivery: string; timestamp: string }> = [];
    const post = async (args: { headers: Record<string, string> }) => {
      seen.push({ delivery: args.headers['X-CP-Delivery']!, timestamp: args.headers['X-CP-Timestamp']! });
      return { status: 503, excerpt: 'unavailable' };
    };
    await fanOutEvents(h.db as never, now);

    const gaps: number[] = [];
    for (let attempt = 1; attempt <= 9; attempt++) {
      const stats = await deliverDue(h.db as never, { policy: DEV, now: clock, post: post as never });
      expect(stats.succeeded).toBe(0);
      const [row] = await deliveriesOf(hook.id);
      expect(row!.attempt).toBe(attempt);
      if (attempt < 9) {
        expect(row).toMatchObject({ status: 'failed', responseCode: 503, lastError: 'HTTP 503' });
        gaps.push(row!.nextAttemptAt!.getTime() - now.getTime());
        // nothing is due before its time
        expect((await deliverDue(h.db as never, { policy: DEV, now: () => new Date(now.getTime() + 1000), post: post as never })).retried).toBe(0);
        now = new Date(row!.nextAttemptAt!.getTime() + 1);
      } else {
        expect(row).toMatchObject({ status: 'abandoned', nextAttemptAt: null });
      }
    }
    RETRY_DELAYS_SECONDS.forEach((seconds, i) => {
      expect(gaps[i]!, `retry ${i + 1}`).toBeGreaterThanOrEqual(seconds * 1000 * 0.8 - 1);
      expect(gaps[i]!, `retry ${i + 1}`).toBeLessThanOrEqual(seconds * 1000 * 1.2 + 1);
    });
    expect(gaps.reduce((a, b) => a + b, 0) / 3_600_000).toBeGreaterThan(8.5); // about 11 hours in total
    expect(new Set(seen.map((s) => s.delivery)).size).toBe(1); // X-CP-Delivery is stable across retries
    expect(new Set(seen.map((s) => s.timestamp)).size).toBeGreaterThan(1); // every attempt is signed fresh
    expect(seen).toHaveLength(9);
    const row = await webhookRow(hook.id);
    expect(row.consecutiveFailures).toBe(1); // one delivery used up all its retries
    expect(row.status).toBe('active');
    expect(row.failingSince).not.toBeNull();
  });

  it('disables the endpoint at once on 410 Gone and abandons what was waiting for it', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await emit('project.updated');
    await fanOutEvents(h.db as never);
    const stats = await deliverDue(h.db as never, { policy: DEV, post: failing(410), batch: 1 });
    expect(stats).toMatchObject({ abandoned: 1, disabled: 1 });
    expect(await webhookRow(hook.id)).toMatchObject({ status: 'disabled', disabledReason: 'endpoint_gone' });
    const next = await deliverDue(h.db as never, { policy: DEV, post: failing(200) });
    expect(next).toMatchObject({ succeeded: 0, abandoned: 1 }); // the second delivery is dropped, not sent
    await emit('project.created');
    expect((await fanOutEvents(h.db as never)).deliveries).toBe(0); // and nothing new is queued for it
  });

  it('disables the endpoint after 50 consecutive failed deliveries', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    await h.db.update(schema.connectorWebhooks).set({ consecutiveFailures: 49 }).where(eq(schema.connectorWebhooks.id, hook.id));
    await h.db.update(schema.connectorDeliveries).set({ attempt: 8, status: 'failed', nextAttemptAt: new Date(0) }).where(eq(schema.connectorDeliveries.webhookId, hook.id));
    const stats = await deliverDue(h.db as never, { policy: DEV, post: failing() });
    expect(stats).toMatchObject({ abandoned: 1, disabled: 1 });
    expect(await webhookRow(hook.id)).toMatchObject({ status: 'disabled', disabledReason: 'too_many_failures', consecutiveFailures: 50 });
  });

  it('disables the endpoint after 3 days of failures', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    await h.db.update(schema.connectorWebhooks).set({ failingSince: new Date(Date.now() - 3 * 86_400_000 - 60_000) }).where(eq(schema.connectorWebhooks.id, hook.id));
    const stats = await deliverDue(h.db as never, { policy: DEV, post: failing() });
    expect(stats.disabled).toBe(1);
    expect(await webhookRow(hook.id)).toMatchObject({ status: 'disabled', disabledReason: 'failing_for_3_days' });
  });

  it('a success clears the failure history', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    await h.db.update(schema.connectorWebhooks).set({ consecutiveFailures: 7, failingSince: new Date(Date.now() - 3_600_000) }).where(eq(schema.connectorWebhooks.id, hook.id));
    expect((await deliverDue(h.db as never, { policy: DEV, post: failing(204) })).succeeded).toBe(1);
    expect(await webhookRow(hook.id)).toMatchObject({ consecutiveFailures: 0, failingSince: null, lastDeliveryStatus: 'succeeded', lastResponseCode: 204 });
  });

  it('treats redirects and network errors as failures, and a blocked address as a reason to disable', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    expect((await deliverDue(h.db as never, { policy: DEV, post: failing(302) })).retried).toBe(1);
    await h.db.update(schema.connectorDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.connectorDeliveries.webhookId, hook.id));
    const network = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect((await deliverDue(h.db as never, { policy: DEV, post: network as never })).retried).toBe(1);
    expect((await deliveriesOf(hook.id))[0]).toMatchObject({ status: 'failed', lastError: 'ECONNREFUSED' });
    await h.db.update(schema.connectorDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.connectorDeliveries.webhookId, hook.id));
    const blocked = async () => {
      throw Object.assign(new Error('Blocked address'), { code: 'EBLOCKED' });
    };
    expect((await deliverDue(h.db as never, { policy: DEV, post: blocked as never })).disabled).toBe(1);
    expect(await webhookRow(hook.id)).toMatchObject({ status: 'disabled', disabledReason: 'unsafe_url' });
  });

  it('re-checks the address at delivery time (an endpoint that became unsafe is not called)', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    const post = vi.fn(async () => ({ status: 200, excerpt: '' }));
    const strict: WebhookUrlPolicy = { production: true, allowPrivate: false };
    const stats = await deliverDue(h.db as never, { policy: strict, post: post as never });
    expect(post).not.toHaveBeenCalled();
    expect(stats.disabled).toBe(1);
    expect(await webhookRow(hook.id)).toMatchObject({ status: 'disabled', disabledReason: 'unsafe_url' });
  });

  it('picks a delivery up again when its worker died mid-flight, and never sends twice in one tick', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    await fanOutEvents(h.db as never);
    const post = vi.fn(async () => ({ status: 200, excerpt: '' }));
    await h.db.update(schema.connectorDeliveries).set({ status: 'delivering', lockedUntil: new Date(Date.now() - 1000), attempt: 1 }).where(eq(schema.connectorDeliveries.webhookId, hook.id));
    expect((await deliverDue(h.db as never, { policy: DEV, post: post as never })).succeeded).toBe(1);
    expect((await deliverDue(h.db as never, { policy: DEV, post: post as never })).succeeded).toBe(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(hook.id))[0]).toMatchObject({ status: 'succeeded', attempt: 2 });
    // a live lease is respected
    await emit('project.updated');
    await fanOutEvents(h.db as never);
    await h.db.update(schema.connectorDeliveries).set({ status: 'delivering', lockedUntil: new Date(Date.now() + 60_000) }).where(eq(schema.connectorDeliveries.status, 'pending'));
    expect((await deliverDue(h.db as never, { policy: DEV, post: post as never })).succeeded).toBe(0);
  });

  it('does not fan an event out twice', async () => {
    await registered('http://127.0.0.1:9/hook');
    await emit('project.created');
    expect(await fanOutEvents(h.db as never)).toEqual({ events: 1, deliveries: 1 });
    expect(await fanOutEvents(h.db as never)).toEqual({ events: 0, deliveries: 0 });
  });
});

describe('retention', () => {
  it('removes expired data and keeps what is still needed', async () => {
    const hook = await registered('http://127.0.0.1:9/hook');
    const old = await emit('project.created');
    const recent = await emit('project.updated');
    await h.db.update(schema.connectorEvents).set({ createdAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(schema.connectorEvents.id, old!));
    await h.db.insert(schema.connectorIdempotency).values([
      { grantId: grantA, key: 'expired', requestHash: 'x', expiresAt: new Date(Date.now() - 1000) },
      { grantId: grantA, key: 'live', requestHash: 'x', expiresAt: new Date(Date.now() + 3_600_000) },
    ]);
    const [op] = await h.db.insert(schema.connectorOperations).values({ grantId: grantA, orgId: orgA.id, action: 'projects.waitForDeployment', input: {}, status: 'running', deadlineAt: new Date(Date.now() - 1000) }).returning();
    await h.db.insert(schema.connectorOperations).values({ grantId: grantA, orgId: orgA.id, action: 'x', input: {}, status: 'succeeded', createdAt: new Date(Date.now() - 8 * 86_400_000) });

    const result = await runConnectorRetention(h.db as never);
    expect(result).toMatchObject({ events: 1, idempotency: 1, operations: 1, timedOut: 1 });
    expect((await h.db.select().from(schema.connectorEvents)).map((e) => e.id)).toEqual([recent]);
    expect((await h.db.select().from(schema.connectorIdempotency)).map((r) => r.key)).toEqual(['live']);
    const [settled] = await h.db.select().from(schema.connectorOperations).where(eq(schema.connectorOperations.id, op!.id));
    expect(settled).toMatchObject({ status: 'failed', error: { code: 'timeout' } });
    expect(hook.id).toBeTruthy();
  });
});
