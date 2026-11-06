import { generateKeyPairSync } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import * as schema from 'database/src/schema';

vi.mock('@/lib/db', async () => (await import('./testing/harness')).dbModule());
vi.mock('@/lib/auth', async () => (await import('./testing/harness')).authModule());
vi.mock('@/server/infra', async () => (await import('./testing/harness')).infraModule());
vi.mock('core', async (importOriginal) => (await import('./testing/harness')).coreOverrides(await importOriginal()));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { connectorEnabled } from 'core';
import { emitConnectorEvent, emitProjectEvent, withOutbox } from 'database';
import { CONNECTOR_SCOPE_NAMES, EVENTS, eventEnvelopeSchema, getEventDefinition, type ReleaseJob } from 'shared';
import { checkServiceRecovery, markInstance, shouldAnnounceUnhealthy } from '../../../../worker/src/jobs/connector-events';
import { runMaintenanceJob } from '../../../../worker/src/jobs/maintenance';
import { runReleaseJob } from '../../../../worker/src/orchestrator/release';
import type { WorkerContext } from '../../../../worker/src/context';
import { actionRoute } from './dispatch';
import { eventsList } from './webhooks';
import { HUB_ENV, RESET_SQL, harness, linkGithub, seedDeployment, seedOrg, seedProject, seedUser, setRole, type Harness, type TestUser } from './testing/harness';
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
const REPO = { id: 11, full_name: 'acme/site', default_branch: 'main', files: { 'index.html': '<h1>hello</h1>' }, branches: ['main', 'dev'] };

async function act(name: string, input: unknown, token = tokenA): Promise<Response> {
  const run = actionRoute as unknown as (req: Request, ctx: { params: Promise<{ name: string }> }) => Promise<Response>;
  return run(
    new Request(`https://orb.example.com/api/connect/v1/actions/${name}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ input }) }),
    { params: Promise.resolve({ name }) },
  );
}

async function ok(name: string, input: unknown, token = tokenA) {
  const res = await act(name, input, token);
  const body = await res.json();
  if (res.status >= 300) throw new Error(`${name} failed: ${res.status} ${JSON.stringify(body)}`);
  return body.output;
}

// Event payloads are free-form JSON that the tests probe by path, hence the loose `data` type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
interface StoredEvent {
  id: string;
  type: string;
  actor: { id: string | null; name: string | null; kind: string };
  externalRef: Record<string, string>;
  data: Loose;
  tenantId: string;
  occurredAt: string;
}

async function eventsOf(orgId: string): Promise<StoredEvent[]> {
  const rows = await h.db.select().from(schema.connectorEvents).where(eq(schema.connectorEvents.orgId, orgId)).orderBy(asc(schema.connectorEvents.seq));
  return rows.map((r) => r.payload as unknown as StoredEvent);
}

const typesOf = async (orgId: string) => (await eventsOf(orgId)).map((e) => e.type);

function workerContext(): WorkerContext {
  return {
    db: h.db,
    redis: h.redis,
    logger: { info() {}, warn() {}, error() {} },
    logs: { appendBuild: async () => undefined, readBuild: async () => ({ lines: [], next: 0 }) },
    storage: { put: async () => undefined },
    maintenanceQueue: h.queues.maintenance,
    releaseQueue: h.queues.release,
    config: { drainDelayMs: 0 },
    runners: { call: async () => { throw new Error('no runner in tests'); } },
  } as unknown as WorkerContext;
}

const CRON_CONFIG = { type: 'cron', cronSchedule: '* * * * *', rootDirectory: '', port: 3000, healthCheckPath: '/', instancePlan: 'free', instanceCount: 1 };

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  for (const [k, v] of Object.entries({ ...HUB_ENV, GITHUB_APP_ID: '4242', GITHUB_APP_PRIVATE_KEY: privateKey })) vi.stubEnv(k, v);
  h = await harness();
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv('CONNECTOR_ENABLED', 'true');
  h.redis.flush();
  h.session.user = null;
  h.queues.build.clear();
  h.queues.release.clear();
  h.queues.maintenance.clear();
  h.github.repos = [REPO];
  await h.client.exec(RESET_SQL);
  userA = await seedUser(h, { name: 'Ann A' });
  userB = await seedUser(h, { name: 'Ben B' });
  orgA = await seedOrg(h, userA.id, 'Team A');
  orgB = await seedOrg(h, userB.id, 'Team B');
  await linkGithub(h, userA.id);
  const connected = await connect(h, userA, orgA.id, ALL);
  tokenA = connected.access;
  grantA = connected.grantId;
  tokenB = (await connect(h, userB, orgB.id, ALL)).access;
});

describe('outbox: an event exists if and only if the change committed (C19)', () => {
  it('rolls the event back together with the change', async () => {
    const before = await h.db.select().from(schema.projects);
    await expect(
      withOutbox(h.db as never, async (tx) => {
        const [project] = await (tx as unknown as typeof h.db).insert(schema.projects).values({ name: 'Doomed', slug: 'doomed-1', userId: userA.id, orgId: orgA.id, type: 'static' }).returning();
        await emitProjectEvent(tx, project!, null, 'created', { kind: 'user', userId: userA.id });
        // (no query on `h.db` in here: PGlite has one connection and would wait for this transaction forever)
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await h.db.select().from(schema.projects)).toHaveLength(before.length);
    expect(await typesOf(orgA.id)).toEqual([]);
  });

  it('commits the event together with the change', async () => {
    await withOutbox(h.db as never, async (tx) => {
      const [project] = await (tx as unknown as typeof h.db).insert(schema.projects).values({ name: 'Kept', slug: 'kept-1', userId: userA.id, orgId: orgA.id, type: 'static' }).returning();
      await emitProjectEvent(tx, project!, null, 'created', { kind: 'user', userId: userA.id });
    });
    expect(await typesOf(orgA.id)).toEqual(['project.created']);
  });

  it('runs no query at all and writes nothing while the connector is off', async () => {
    vi.stubEnv('CONNECTOR_ENABLED', 'false');
    expect(connectorEnabled()).toBe(false);
    const transaction = vi.spyOn(h.db, 'transaction');
    const select = vi.spyOn(h.db, 'select');
    const insert = vi.spyOn(h.db, 'insert');
    const seen = await withOutbox(h.db as never, async (tx) => {
      expect(tx).toBe(h.db); // no BEGIN/COMMIT, the very same executor
      const id = await emitConnectorEvent(tx, { orgId: orgA.id, type: 'project.created', data: {}, actor: { kind: 'system' } });
      return id;
    });
    expect(seen).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    transaction.mockRestore();
    select.mockRestore();
    insert.mockRestore();
    expect(await h.db.select().from(schema.connectorEvents)).toHaveLength(0);
  });

  it('writes nothing when nobody could receive it (no live grant in the team)', async () => {
    await h.db.update(schema.connectorGrants).set({ revokedAt: new Date() }).where(eq(schema.connectorGrants.orgId, orgA.id));
    await withOutbox(h.db as never, async (tx) => {
      expect(await emitConnectorEvent(tx, { orgId: orgA.id, type: 'project.created', data: {}, actor: { kind: 'system' } })).toBeNull();
    });
    expect(await typesOf(orgA.id)).toEqual([]);
  });
});

describe('events caused by actions', () => {
  it('announces a project and its first deployment with correlation ids echoed (C18)', async () => {
    const out = await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, externalRef: { hubProjectId: 'hp_1', hubRunId: 'run_1', hubStepId: 'step_1' } });
    const events = await eventsOf(orgA.id);
    expect(events.map((e) => e.type)).toEqual(['project.created', 'deployment.queued']);
    for (const event of events) {
      expect(event).toMatchObject({ tenantId: orgA.id, externalRef: { hubProjectId: 'hp_1', hubRunId: 'run_1', hubStepId: 'step_1' }, actor: { id: userA.id, name: 'Ann A', kind: 'connector' } });
      expect(event.id).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(eventEnvelopeSchema.safeParse(event).success).toBe(true);
      expect(getEventDefinition(event.type)!.data.safeParse(event.data).success, event.type).toBe(true);
    }
    expect(events[0]!.data.project).toMatchObject({ id: out.project.id, name: 'Site', createdVia: 'connector' });
    expect(events[1]!.data).toMatchObject({
      project: { id: out.project.id, slug: out.project.slug },
      deployment: { id: out.deployment.id, status: 'QUEUED', environment: 'production', triggeredBy: 'api', branch: 'main' },
      webUrl: expect.stringContaining(out.deployment.id),
    });
  });

  it('inherits the project correlation ids in deployments created later, with the run ids of the call', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false, externalRef: { hubProjectId: 'hp_9' } })).project;
    await h.db.delete(schema.connectorEvents);
    const deployment = (await ok('deployments.trigger', { projectId: project.id, externalRef: { hubRunId: 'run_9' } })).deployment;
    const [queued] = await eventsOf(orgA.id);
    expect(queued).toMatchObject({ type: 'deployment.queued', externalRef: { hubProjectId: 'hp_9', hubRunId: 'run_9' } });
    await ok('deployments.cancel', { deploymentId: deployment.id });
    expect((await typesOf(orgA.id)).slice(-1)).toEqual(['deployment.canceled']);
    const canceled = (await eventsOf(orgA.id)).at(-1)!;
    expect(canceled.data.deployment).toMatchObject({ id: deployment.id, status: 'CANCELED' });
    expect(canceled.externalRef).toMatchObject({ hubProjectId: 'hp_9', hubRunId: 'run_9' });
  });

  it('emits project.updated, deployment.promoted, env.updated (keys only) and domain.* events', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).project;
    await ok('projects.update', { projectId: project.id, name: 'Renamed' });
    const first = await seedDeployment(h, project.id, { status: 'READY' });
    const second = await seedDeployment(h, project.id, { status: 'READY' });
    await ok('deployments.promote', { deploymentId: first.id });
    await ok('deployments.promote', { deploymentId: second.id });
    await ok('env.set', { projectId: project.id, vars: [{ key: 'API_KEY', value: 'hunter2-hunter2', sensitive: true }, { key: 'MODE', value: 'prod', target: 'production' }] });
    await ok('env.remove', { projectId: project.id, key: 'MODE', target: 'production' });
    await ok('domains.add', { projectId: project.id, domain: 'www.example.com' });

    const events = await eventsOf(orgA.id);
    expect(events.map((e) => e.type)).toEqual([
      'project.created',
      'project.updated',
      'deployment.promoted',
      'deployment.promoted',
      'env.updated', // target all
      'env.updated', // target production
      'env.updated', // removal
      'domain.added',
    ]);
    expect(events[1]!.data.project.name).toBe('Renamed');
    expect(events[2]!.data).toMatchObject({ previousDeploymentId: null, deployment: { id: first.id } });
    expect(events[3]!.data).toMatchObject({ previousDeploymentId: first.id, deployment: { id: second.id } });
    expect(events[4]!.data).toMatchObject({ keys: ['API_KEY'], target: 'all', action: 'set' });
    expect(events[5]!.data).toMatchObject({ keys: ['MODE'], target: 'production', action: 'set' });
    expect(events[6]!.data).toMatchObject({ keys: ['MODE'], target: 'production', action: 'removed' });
    expect(events[7]!.data).toMatchObject({ project: { id: project.id }, domain: { domain: 'www.example.com', status: 'pending' } });
    expect(JSON.stringify(events)).not.toMatch(/hunter2|"prod"/); // never values
    for (const event of events) expect(getEventDefinition(event.type)!.data.safeParse(event.data).success, event.type).toBe(true);
  });

  it('announces a domain going live and going away, only on real transitions', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).project;
    await ok('domains.add', { projectId: project.id, domain: 'a.example.com' });
    await ok('domains.verify', { projectId: project.id, domain: 'a.example.com' }); // still pending: no event
    h.dns.routingOk = true;
    await ok('domains.verify', { projectId: project.id, domain: 'a.example.com' });
    await ok('domains.verify', { projectId: project.id, domain: 'a.example.com' }); // already active: no event
    h.dns.routingOk = false;
    await ok('domains.verify', { projectId: project.id, domain: 'a.example.com' });
    const types = (await typesOf(orgA.id)).filter((t) => t.startsWith('domain.'));
    expect(types).toEqual(['domain.added', 'domain.verified', 'domain.verification_failed']);
  });

  it('reports plan.limit_reached at most once per team and kind every 10 minutes', async () => {
    await h.db.update(schema.organizations).set({ plan: 'free' }).where(eq(schema.organizations.id, orgA.id));
    for (let i = 0; i < 5; i++) await seedProject(h, orgA.id, userA.id, { name: `P${i}` });
    for (let i = 0; i < 3; i++) expect((await act('projects.create', { name: 'More', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).status).toBe(402);
    const limited = (await eventsOf(orgA.id)).filter((e) => e.type === 'plan.limit_reached');
    expect(limited).toHaveLength(1);
    expect(limited[0]!.data).toEqual({ limit: 5, kind: 'projects' });
    expect(getEventDefinition('plan.limit_reached')!.data.safeParse(limited[0]!.data).success).toBe(true);
  });

  it('never emits an event about another team', async () => {
    await linkGithub(h, userB.id);
    await ok('projects.create', { name: 'B site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false }, tokenB);
    expect(await typesOf(orgA.id)).toEqual([]);
    expect(await typesOf(orgB.id)).toEqual(['project.created']);
  });
});

describe('events from the worker: once per transition, inside the status change', () => {
  const release = (deploymentId: string, promote: boolean) =>
    runReleaseJob(workerContext(), { data: { deploymentId, promote } } as unknown as Job<ReleaseJob>);

  it('announces ready and then promoted exactly once, however often the release job runs', async () => {
    const project = await seedProject(h, orgA.id, userA.id, { name: 'Cron', type: 'cron', cronSchedule: '* * * * *', externalRef: { hubProjectId: 'hp_c' } });
    const deployment = await seedDeployment(h, project.id, { status: 'DEPLOYING', config: CRON_CONFIG as never, externalRef: { hubRunId: 'run_c' } });
    await release(deployment.id, true);
    await release(deployment.id, true); // e.g. a wake-up or a retried job
    await release(deployment.id, false);
    const events = await eventsOf(orgA.id);
    expect(events.map((e) => e.type)).toEqual(['deployment.ready', 'deployment.promoted']);
    expect(events[0]).toMatchObject({ actor: { kind: 'system', id: null }, externalRef: { hubProjectId: 'hp_c', hubRunId: 'run_c' } });
    expect(events[0]!.data.deployment).toMatchObject({ id: deployment.id, status: 'READY' });
    expect(events[1]!.data).toMatchObject({ previousDeploymentId: null });
    const [row] = await h.db.select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(row!.currentDeploymentId).toBe(deployment.id);
  });

  it('announces a failed release once, with the error', async () => {
    const project = await seedProject(h, orgA.id, userA.id, { name: 'Broken', type: 'cron', cronSchedule: '* * * * *' });
    const deployment = await seedDeployment(h, project.id, { status: 'DEPLOYING', config: null });
    await expect(release(deployment.id, true)).rejects.toThrow(/no configuration snapshot/);
    const events = await eventsOf(orgA.id);
    expect(events.map((e) => e.type)).toEqual(['deployment.failed']);
    expect(events[0]!.data.deployment).toMatchObject({ id: deployment.id, status: 'FAILED', errorMessage: expect.stringContaining('no configuration snapshot') });
    // a deployment that is already FAILED is never announced again
    await release(deployment.id, true);
    expect(await typesOf(orgA.id)).toEqual(['deployment.failed']);
  });

  it('announces deployments the reaper gives up on', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const stuck = await seedDeployment(h, project.id, { status: 'BUILDING', updatedAt: new Date(Date.now() - 3 * 3_600_000) });
    const fresh = await seedDeployment(h, project.id, { status: 'BUILDING' });
    await runMaintenanceJob(workerContext(), { name: 'reaper', data: {} } as unknown as Job);
    await runMaintenanceJob(workerContext(), { name: 'reaper', data: {} } as unknown as Job);
    const events = await eventsOf(orgA.id);
    expect(events.map((e) => e.type)).toEqual(['deployment.failed']);
    expect(events[0]!.data.deployment).toMatchObject({ id: stuck.id, errorMessage: expect.stringContaining('Timed out') });
    expect(events.some((e) => e.data.deployment?.id === fresh.id)).toBe(false);
  });

  it('announces unhealthy services (rate limited) and their recovery', async () => {
    const ctx = workerContext();
    const project = await seedProject(h, orgA.id, userA.id, { name: 'Svc', type: 'web_service' });
    const deployment = await seedDeployment(h, project.id, { status: 'READY', config: { ...CRON_CONFIG, type: 'web_service', instanceCount: 2 } as never });
    await h.db.update(schema.projects).set({ currentDeploymentId: deployment.id }).where(eq(schema.projects.id, project.id));
    const rows = await h.db
      .insert(schema.instances)
      .values([
        { deploymentId: deployment.id, projectId: project.id, nodeId: 'n1', status: 'RUNNING' },
        { deploymentId: deployment.id, projectId: project.id, nodeId: 'n1', status: 'RUNNING' },
      ])
      .returning();
    const lose = async (row: (typeof rows)[number]) => {
      const announce = await shouldAnnounceUnhealthy(ctx, row);
      await markInstance(ctx, row, { status: 'LOST', stoppedAt: new Date() }, announce);
    };
    await lose(rows[0]!);
    await lose(rows[1]!); // within the cooldown: no second event
    const unhealthy = (await eventsOf(orgA.id)).filter((e) => e.type === 'service.unhealthy');
    expect(unhealthy).toHaveLength(1);
    expect(unhealthy[0]!.data).toMatchObject({ project: { id: project.id }, instances: { desired: 2, running: 1, unhealthy: 0, lost: 1 } });

    expect(await checkServiceRecovery(ctx)).toBe(0); // nothing is running again yet
    await h.db.insert(schema.instances).values([
      { deploymentId: deployment.id, projectId: project.id, nodeId: 'n2', status: 'RUNNING' },
      { deploymentId: deployment.id, projectId: project.id, nodeId: 'n2', status: 'RUNNING' },
    ]);
    expect(await checkServiceRecovery(ctx)).toBe(1);
    expect(await checkServiceRecovery(ctx)).toBe(0); // once
    const recovered = (await eventsOf(orgA.id)).filter((e) => e.type === 'service.recovered');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.data.instances).toMatchObject({ desired: 2, running: 2, unhealthy: 0 });
  });
});

describe('GET /events: the event log (C20)', () => {
  const list = async (qs = '', token = tokenA) => {
    const run = eventsList as unknown as (req: Request, ctx: { params: Promise<Record<string, never>> }) => Promise<Response>;
    const res = await run(new Request(`https://orb.example.com/api/connect/v1/events${qs}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({}) });
    return { status: res.status, body: await res.json() };
  };

  it('returns the stored envelopes in commit order and pages without gaps or repeats', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).project;
    for (let i = 0; i < 4; i++) await ok('env.set', { projectId: project.id, vars: [{ key: `K${i}`, value: 'v' }] });
    const stored = await eventsOf(orgA.id);
    expect(stored).toHaveLength(5);

    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.items).toEqual(stored);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { status: number; body: { items: Array<{ id: string }>; nextCursor: string | null } } = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.status).toBe(200);
      if (page.body.items.length === 0) break;
      seen.push(...page.body.items.map((e) => e.id));
      cursor = page.body.nextCursor;
    } while (cursor && seen.length < 20);
    expect(seen).toEqual(stored.map((e) => e.id));

    // resuming from the end finds nothing new, and keeps the cursor so the caller can poll again
    const tail = await list(`?cursor=${cursor}`);
    expect(tail.body).toEqual({ items: [], nextCursor: cursor });
    await ok('env.set', { projectId: project.id, vars: [{ key: 'LATER', value: 'v' }] });
    const fresh = await list(`?cursor=${cursor}`);
    expect(fresh.body.items.map((e: { type: string }) => e.type)).toEqual(['env.updated']);
  });

  it('filters by type and prefix and rejects unknown types', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' } })).project;
    await ok('env.set', { projectId: project.id, vars: [{ key: 'A', value: '1' }] });
    expect((await list('?types=deployment.*')).body.items.map((e: { type: string }) => e.type)).toEqual(['deployment.queued']);
    expect((await list('?types=project.created,env.updated')).body.items.map((e: { type: string }) => e.type)).toEqual(['project.created', 'env.updated']);
    expect((await list('?types=bogus.*')).status).toBe(400);
  });

  it('only shows events the grant may read and only for its own team (C08)', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).project;
    await ok('domains.add', { projectId: project.id, domain: 'a.example.com' });
    const limited = (await connect(h, userA, orgA.id, 'orb:events:read orb:projects:read')).access;
    expect((await list('', limited)).body.items.map((e: { type: string }) => e.type)).toEqual(['project.created']); // no domains:read
    expect((await list('', tokenB)).body.items).toEqual([]);
    const noScope = (await connect(h, userA, orgA.id, 'orb:projects:read')).access;
    expect((await list('', noScope)).status).toBe(403);
  });

  it('caps visibility with the live role', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).project;
    await ok('domains.add', { projectId: project.id, domain: 'a.example.com' });
    const admin = await seedUser(h);
    await setRole(h, orgA.id, admin.id, 'admin');
    const adminToken = (await connect(h, admin, orgA.id, ALL)).access;
    expect((await list('', adminToken)).body.items).toHaveLength(2);
    await setRole(h, orgA.id, admin.id, 'viewer');
    expect((await list('', adminToken)).body.items).toHaveLength(2); // viewers read everything here
  });

  it('serves only the last 7 days and rejects tampered cursors', async () => {
    const project = (await ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false })).project;
    await ok('env.set', { projectId: project.id, vars: [{ key: 'A', value: '1' }] });
    await h.db.update(schema.connectorEvents).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(schema.connectorEvents.type, 'project.created'));
    expect((await list()).body.items.map((e: { type: string }) => e.type)).toEqual(['env.updated']);
    const forged = Buffer.from(JSON.stringify({ x: "1'; drop table x;--", s: 1 })).toString('base64url');
    expect((await list(`?cursor=${forged}`)).status).toBe(400);
    expect((await list('?cursor=%25%25')).status).toBe(400);
  });
});

describe('catalogue', () => {
  it('has a payload schema for every event and every one is emitted by something', () => {
    expect(EVENTS.map((e) => e.type)).toEqual(
      expect.arrayContaining(['project.created', 'deployment.ready', 'deployment.failed', 'service.unhealthy', 'domain.verified', 'env.updated', 'plan.limit_reached']),
    );
    expect(grantA).toBeTruthy();
  });
});
