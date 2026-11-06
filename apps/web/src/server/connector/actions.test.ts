import { generateKeyPairSync } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from 'database/src/schema';

vi.mock('@/lib/db', async () => (await import('./testing/harness')).dbModule());
vi.mock('@/lib/auth', async () => (await import('./testing/harness')).authModule());
vi.mock('@/server/infra', async () => (await import('./testing/harness')).infraModule());
vi.mock('core', async (importOriginal) => (await import('./testing/harness')).coreOverrides(await importOriginal()));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { ACTIONS, CONNECTOR_SCOPE_NAMES, type ActionName } from 'shared';
import { actionRoute, operationRoute } from './dispatch';
import { requestHash } from './idempotency';
import { HUB_ENV, RESET_SQL, harness, linkGithub, seedDeployment, seedOrg, seedProject, seedUser, setRole, type Harness, type TestUser } from './testing/harness';
import { connect } from './testing/flow';

let h: Harness;
let userA: TestUser;
let userB: TestUser;
let orgA: Awaited<ReturnType<typeof seedOrg>>;
let orgB: Awaited<ReturnType<typeof seedOrg>>;
let tokenA: string;
let tokenB: string;

const ALL = CONNECTOR_SCOPE_NAMES.join(' ');
const REPO = { id: 11, full_name: 'acme/site', default_branch: 'main', files: { 'index.html': '<h1>hello</h1>' }, branches: ['main', 'dev'] };

interface Opts {
  token?: string;
  key?: string;
  headers?: Record<string, string>;
  raw?: string;
}

async function act(name: string, input: unknown, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  headers.authorization = `Bearer ${opts.token ?? tokenA}`;
  if (opts.key) headers['idempotency-key'] = opts.key;
  const run = actionRoute as unknown as (req: Request, ctx: { params: Promise<{ name: string }> }) => Promise<Response>;
  return run(new Request(`https://orb.example.com/api/connect/v1/actions/${name}`, { method: 'POST', headers, body: opts.raw ?? JSON.stringify({ input }) }), { params: Promise.resolve({ name }) });
}

async function ok(name: ActionName, input: unknown, opts: Opts = {}) {
  const res = await act(name, input, opts);
  const body = await res.json();
  if (res.status >= 300) throw new Error(`${name} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function poll(id: string, token = tokenA): Promise<{ status: number; body: Record<string, unknown> }> {
  const run = operationRoute as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const res = await run(new Request(`https://orb.example.com/api/connect/v1/operations/${id}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

const createSite = (extra: Record<string, unknown> = {}, opts: Opts = {}) =>
  ok('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, ...extra }, opts);

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  for (const [k, v] of Object.entries({ ...HUB_ENV, GITHUB_APP_ID: '4242', GITHUB_APP_PRIVATE_KEY: privateKey })) vi.stubEnv(k, v);
  h = await harness();
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  h.redis.flush();
  h.session.user = null;
  h.queues.build.clear();
  h.queues.release.clear();
  h.dns.routingOk = false;
  h.github.repos = [REPO];
  h.github.installed = new Set();
  await h.client.exec(RESET_SQL);
  userA = await seedUser(h, { name: 'Ann A' });
  userB = await seedUser(h, { name: 'Ben B' });
  orgA = await seedOrg(h, userA.id, 'Team A');
  orgB = await seedOrg(h, userB.id, 'Team B');
  await linkGithub(h, userA.id);
  tokenA = (await connect(h, userA, orgA.id, ALL)).access;
  tokenB = (await connect(h, userB, orgB.id, ALL)).access;
});

describe('projects.create', () => {
  it('creates a project from a GitHub repository, stores correlation data and queues the first deployment', async () => {
    const body = await createSite({ metadata: { source: 'hub' }, externalRef: { hubProjectId: 'hp_1', hubRunId: 'run_1' } });
    const out = body.output;
    expect(out.project).toMatchObject({ name: 'Site', type: 'static', source: 'git', createdVia: 'connector', metadata: { source: 'hub' }, externalRef: { hubProjectId: 'hp_1', hubRunId: 'run_1' } });
    expect(out.repository).toMatchObject({ fullName: 'acme/site', id: 11, branch: 'main' });
    expect(out.deployment).toMatchObject({ status: 'QUEUED', triggeredBy: 'api', environment: 'production', branch: 'main', createdVia: 'connector', externalRef: { hubProjectId: 'hp_1', hubRunId: 'run_1' } });
    expect(h.queues.build.jobs).toHaveLength(1);
    expect(h.queues.build.jobs[0]!.data).toEqual({ deploymentId: out.deployment.id });
    expect(ACTIONS['projects.create'].output.safeParse(out).success).toBe(true);

    const [row] = await h.db.select().from(schema.projects).where(eq(schema.projects.id, out.project.id));
    expect(row).toMatchObject({ orgId: orgA.id, userId: userA.id, createdVia: 'connector' });
  });

  it('reports whether push-to-deploy is active and tells the user how to fix it (GitHub App)', async () => {
    const before = (await createSite()).output;
    expect(before.autoDeploy).toBe(false);
    expect(before.warnings).toEqual([expect.objectContaining({ code: 'github_app_not_installed', fixUrl: 'https://github.com/apps/orb-test/installations/new' })]);
    expect(before.pushToDeployHint).toMatchObject({ remote: 'https://github.com/acme/site.git', branch: 'main' });
    expect(before.pushToDeployHint.message).toMatch(/Install the Orb GitHub App/);

    h.github.installed = new Set(['acme/site']);
    const after = (await createSite({ name: 'Site two' })).output;
    expect(after.autoDeploy).toBe(true);
    expect(after.warnings).toEqual([]);
    expect(after.pushToDeployHint.message).toMatch(/Push to main/);
  });

  it('creates an empty repository without a deployment and says so (the first push builds it)', async () => {
    h.github.repos = [{ id: 12, full_name: 'acme/empty', default_branch: 'main', files: {} }];
    const out = (await createSite({ name: 'Empty', repository: { fullName: 'acme/empty' } })).output;
    expect(out.deployment).toBeNull();
    expect(out.project.id).toBeTruthy();
    expect(out.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'no_detectable_framework' })]));
    expect(h.queues.build.jobs).toHaveLength(0);
  });

  it('answers 412 precondition_failed with a fixUrl when the connecting user has not linked GitHub', async () => {
    const res = await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' } }, { token: tokenB });
    expect(res.status).toBe(412);
    expect((await res.json()).error).toMatchObject({ code: 'precondition_failed', reason: 'github_not_connected', fixUrl: expect.stringContaining('/login'), retryable: false });
    expect(await h.db.select().from(schema.projects)).toHaveLength(0);
  });

  it('needs deployments:write only when it deploys', async () => {
    const { access } = await connect(h, userA, orgA.id, 'orb:projects:write orb:github:read');
    const denied = await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' } }, { token: access });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatchObject({ code: 'insufficient_scope', requiredScope: 'orb:deployments:write' });
    const created = await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, deploy: false }, { token: access });
    expect(created.status).toBe(200);
    expect((await created.json()).output.deployment).toBeNull();
  });

  it('creates a Docker image project and stores environment variables encrypted', async () => {
    const out = (
      await ok('projects.create', {
        name: 'API',
        type: 'web_service',
        source: 'image',
        image: 'ghcr.io/acme/api:1.0',
        envVars: [{ key: 'DATABASE_URL', value: 'postgres://very-secret', sensitive: true }, { key: 'LOG_LEVEL', value: 'info', sensitive: false, target: 'production' }],
      })
    ).output;
    expect(out.project).toMatchObject({ source: 'image', image: 'ghcr.io/acme/api:1.0', repository: null });
    expect(out.warnings).toEqual([]);
    const vars = await h.db.select().from(schema.environmentVariables).where(eq(schema.environmentVariables.projectId, out.project.id));
    expect(vars).toHaveLength(2);
    expect(JSON.stringify(vars)).not.toContain('postgres://very-secret');
    expect(vars.find((v) => v.key === 'LOG_LEVEL')).toMatchObject({ isSecret: false, target: 'production' });
    expect(JSON.stringify(out)).not.toContain('very-secret');
  });

  it('maps plan limits to 402 plan_limit with the limit', async () => {
    await h.db.update(schema.organizations).set({ plan: 'free' }).where(eq(schema.organizations.id, orgA.id));
    for (let i = 0; i < 5; i++) await seedProject(h, orgA.id, userA.id, { name: `P${i}` });
    const res = await act('projects.create', { name: 'Sixth', type: 'static', repository: { fullName: 'acme/site' }, deploy: false });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatchObject({ code: 'plan_limit', limit: 5, kind: 'projects', retryable: false });
  });

  it('validates input strictly, with paths', async () => {
    const unknown = await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, surprise: true });
    expect(unknown.status).toBe(400);
    const bad = await act('projects.create', { name: 'x', type: 'blob' });
    expect(bad.status).toBe(400);
    const { error } = await bad.json();
    expect(error.code).toBe('validation_failed');
    expect(error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'type']));
    const lenient = await act('projects.create', { name: 'Site', type: 'static', repository: { fullName: 'acme/site' }, surprise: true, deploy: false }, { headers: { prefer: 'unknown-fields=ignore' } });
    expect(lenient.status).toBe(200);
    const notFound = await act('projects.create', { name: 'Ghost', type: 'static', repository: { fullName: 'acme/ghost' }, deploy: false });
    expect(notFound.status).toBe(404);
  });
});

describe('projects.detectFramework and projects.update', () => {
  it('detects the framework with the same detector as the build worker', async () => {
    const out = (await ok('projects.detectFramework', { repository: { fullName: 'acme/site', branch: 'main' } })).output;
    expect(out).toMatchObject({ suggestedType: 'static', hasDetectableFramework: true });
    expect(out.detection.framework).toBe('static-html');
    h.github.repos = [{ id: 12, full_name: 'acme/empty', default_branch: 'main', files: {} }];
    const empty = (await ok('projects.detectFramework', { repository: { fullName: 'acme/empty' } })).output;
    expect(empty.hasDetectableFramework).toBe(false);
  });

  it('updates settings, metadata and external reference', async () => {
    const created = (await createSite({ deploy: false })).output.project;
    const updated = (await ok('projects.update', { projectId: created.id, name: 'Renamed', branch: 'dev', previewDeployments: true, metadata: { v: 2 }, externalRef: { hubProjectId: 'hp_2' } })).output.project;
    expect(updated).toMatchObject({ name: 'Renamed', previewDeployments: true, repository: { branch: 'dev' }, metadata: { v: 2 }, externalRef: { hubProjectId: 'hp_2' } });
  });
});

describe('deployments.*', () => {
  const projectOf = async (extra: Record<string, unknown> = {}) => (await createSite({ deploy: false, externalRef: { hubProjectId: 'hp' }, ...extra })).output.project;

  it('triggers a production deployment of the production branch and a preview of any other', async () => {
    const project = await projectOf();
    const prod = (await ok('deployments.trigger', { projectId: project.id, externalRef: { hubRunId: 'r1', hubStepId: 's1' } })).output.deployment;
    expect(prod).toMatchObject({ status: 'QUEUED', environment: 'production', branch: 'main', triggeredBy: 'api', createdVia: 'connector', externalRef: { hubProjectId: 'hp', hubRunId: 'r1', hubStepId: 's1' } });
    const preview = (await ok('deployments.trigger', { projectId: project.id, branch: 'dev' })).output.deployment;
    expect(preview).toMatchObject({ environment: 'preview', branch: 'dev' });
    expect(h.queues.build.jobs.map((j) => (j.data as { deploymentId: string }).deploymentId)).toEqual([prod.id, preview.id]);
    expect(ACTIONS['deployments.trigger'].output.safeParse({ deployment: prod }).success).toBe(true);
  });

  it('refuses previews on a plan without them', async () => {
    await h.db.update(schema.organizations).set({ plan: 'free' }).where(eq(schema.organizations.id, orgA.id));
    const project = await projectOf();
    const res = await act('deployments.trigger', { projectId: project.id, branch: 'dev' });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatchObject({ code: 'plan_limit', kind: 'preview_deployments' });
  });

  it('cancels a queued deployment once, and reports a conflict afterwards', async () => {
    const project = await projectOf();
    const queued = (await ok('deployments.trigger', { projectId: project.id })).output.deployment;
    const canceled = (await ok('deployments.cancel', { deploymentId: queued.id })).output.deployment;
    expect(canceled.status).toBe('CANCELED');
    const again = await act('deployments.cancel', { deploymentId: queued.id });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('conflict');
  });

  it('redeploys with the same commit and settings', async () => {
    const project = await projectOf();
    const first = await seedDeployment(h, project.id, { status: 'READY', commitHash: 'abc1234', commitMessage: 'Initial', config: { type: 'static', rootDirectory: '', port: 3000, healthCheckPath: '/', instancePlan: 'free', instanceCount: 1 } });
    const again = (await ok('deployments.redeploy', { deploymentId: first.id, externalRef: { hubRunId: 'r9' } })).output.deployment;
    expect(again).toMatchObject({ status: 'QUEUED', triggeredBy: 'redeploy', commitSha: 'abc1234', commitMessage: 'Initial', externalRef: { hubProjectId: 'hp', hubRunId: 'r9' } });
  });

  it('promotes a ready deployment only for an admin, like the dashboard', async () => {
    const project = await projectOf();
    const ready = await seedDeployment(h, project.id, { status: 'READY' });
    const member = await seedUser(h);
    await setRole(h, orgA.id, member.id, 'member');
    const asMember = (await connect(h, member, orgA.id, ALL)).access;
    const denied = await act('deployments.promote', { deploymentId: ready.id }, { token: asMember });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('forbidden');

    const promoted = (await ok('deployments.promote', { deploymentId: ready.id })).output;
    expect(promoted).toMatchObject({ queued: false, deployment: { id: ready.id, isCurrent: true } });
    const [row] = await h.db.select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(row!.currentDeploymentId).toBe(ready.id);

    const queued = await seedDeployment(h, project.id, { status: 'QUEUED' });
    const notReady = await act('deployments.promote', { deploymentId: queued.id });
    expect(notReady.status).toBe(409);
  });
});

describe('env.set / env.remove', () => {
  it('sets variables from a list and never echoes their values', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const body = await ok('env.set', { projectId: project.id, vars: [{ key: 'API_KEY', value: 'sk_live_topsecret', sensitive: true }, { key: 'MODE', value: 'prod', sensitive: false, target: 'production', scope: 'runtime' }] });
    expect(body.output).toMatchObject({ projectId: project.id, count: 2, keys: [{ key: 'API_KEY', target: 'all', scope: 'both', sensitive: true }, { key: 'MODE', target: 'production', scope: 'runtime', sensitive: false }] });
    expect(JSON.stringify(body)).not.toMatch(/topsecret|prod"/);
    const stored = await h.db.select().from(schema.environmentVariables).where(eq(schema.environmentVariables.projectId, project.id));
    expect(JSON.stringify(stored)).not.toContain('topsecret');
    expect(stored.find((v) => v.key === 'API_KEY')!.value.startsWith('enc:v1:')).toBe(true);
    // upsert: setting the same key again replaces, it does not duplicate
    await ok('env.set', { projectId: project.id, vars: [{ key: 'API_KEY', value: 'rotated', sensitive: true }] });
    expect((await h.db.select().from(schema.environmentVariables).where(eq(schema.environmentVariables.projectId, project.id)))).toHaveLength(2);
  });

  it('sets variables from a .env file and reports skipped keys', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const out = (await ok('env.set', { projectId: project.id, dotenv: '# comment\nA=1\nexport B="two words"\nPORT=3000\n' })).output;
    expect(out.keys.map((k: { key: string }) => k.key)).toEqual(['A', 'B']);
    expect(out.keys.every((k: { sensitive: boolean }) => k.sensitive)).toBe(true);
    expect(out.skipped).toEqual(['PORT']); // reserved by the platform
    expect((await act('env.set', { projectId: project.id, dotenv: '# nothing' })).status).toBe(400);
  });

  it('rejects ambiguous input and reserved keys', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    expect((await act('env.set', { projectId: project.id })).status).toBe(400);
    expect((await act('env.set', { projectId: project.id, vars: [{ key: 'PATH', value: 'x' }] })).status).toBe(400);
  });

  it('removes a variable and is a no-op for one that does not exist', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    await ok('env.set', { projectId: project.id, vars: [{ key: 'TO_GO', value: 'v' }] });
    expect((await ok('env.remove', { projectId: project.id, key: 'TO_GO' })).output).toEqual({ projectId: project.id, key: 'TO_GO', target: 'all', removed: true });
    expect((await ok('env.remove', { projectId: project.id, key: 'TO_GO' })).output.removed).toBe(false);
  });
});

describe('domains.*', () => {
  it('adds a domain with its DNS records, verifies it and removes it', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const added = (await ok('domains.add', { projectId: project.id, domain: 'WWW.Example.com' })).output.domain;
    expect(added).toMatchObject({ domain: 'www.example.com', status: 'pending', verified: false });
    expect(added.instructions[0]).toMatchObject({ type: 'CNAME', host: 'www.example.com', purpose: 'routing' });
    expect(JSON.stringify(added)).not.toContain('verificationToken');

    const dup = await act('domains.add', { projectId: project.id, domain: 'www.example.com' });
    expect(dup.status).toBe(409);

    const stillPending = (await ok('domains.verify', { projectId: project.id, domain: 'www.example.com' })).output;
    expect(stillPending.domain.status).toBe('pending');
    expect(stillPending.routing).toMatchObject({ ok: false });
    h.dns.routingOk = true;
    const live = (await ok('domains.verify', { projectId: project.id, domain: 'www.example.com' })).output;
    expect(live.domain).toMatchObject({ status: 'active', verified: true });

    expect((await ok('domains.remove', { projectId: project.id, domain: 'www.example.com' })).output).toEqual({ domain: 'www.example.com', removed: true });
    expect((await act('domains.remove', { projectId: project.id, domain: 'www.example.com' })).status).toBe(404);
  });

  it('rejects platform subdomains and enforces the per-project limit', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    expect((await act('domains.add', { projectId: project.id, domain: 'localhost' })).status).toBe(400);
    await h.db.update(schema.organizations).set({ plan: 'free' }).where(eq(schema.organizations.id, orgA.id));
    await ok('domains.add', { projectId: project.id, domain: 'a.example.com' });
    await ok('domains.add', { projectId: project.id, domain: 'b.example.com' });
    const third = await act('domains.add', { projectId: project.id, domain: 'c.example.com' });
    expect(third.status).toBe(402);
    expect((await third.json()).error).toMatchObject({ code: 'plan_limit', limit: 2, kind: 'domains' });
  });

  it('needs the admin role: a member is capped away from orb:domains:write', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const member = await seedUser(h);
    await setRole(h, orgA.id, member.id, 'member');
    const asMember = (await connect(h, member, orgA.id, ALL)).access;
    const res = await act('domains.add', { projectId: project.id, domain: 'x.example.com' }, { token: asMember });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({ code: 'insufficient_scope', requiredScope: 'orb:domains:write' });
  });
});

describe('projects.waitForDeployment (C14)', () => {
  const start = async (deploymentId: string, extra: Record<string, unknown> = {}, opts: Opts = {}) => act('projects.waitForDeployment', { deploymentId, ...extra }, opts);

  it('answers 202 with an operation that reaches a terminal state with the final deployment', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const deployment = await seedDeployment(h, project.id, { status: 'BUILDING' });
    const res = await start(deployment.id, { timeoutSeconds: 600 });
    expect(res.status).toBe(202);
    const { operation } = await res.json();
    expect(operation).toMatchObject({ status: 'pending', pollUrl: `/api/connect/v1/operations/${operation.id}` });

    const running = await poll(operation.id);
    expect(running.body).toMatchObject({ id: operation.id, action: 'projects.waitForDeployment', status: 'running' });
    expect(running.body.finishedAt).toBeUndefined();

    await h.db.update(schema.deployments).set({ status: 'READY', readyAt: new Date() }).where(eq(schema.deployments.id, deployment.id));
    const done = await poll(operation.id);
    expect(done.body).toMatchObject({ status: 'succeeded', output: { deployment: { id: deployment.id, status: 'READY', url: expect.stringContaining('dep-') } } });
    expect(done.body.finishedAt).toBeTruthy();
    expect((await poll(operation.id)).body.status).toBe('succeeded'); // terminal states are stable
  });

  it('succeeds with a FAILED deployment too, carrying its error', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const deployment = await seedDeployment(h, project.id, { status: 'FAILED', errorMessage: 'Build failed with exit code 1' });
    const { operation } = await (await start(deployment.id)).json();
    const result = await poll(operation.id);
    expect(result.body).toMatchObject({ status: 'succeeded', output: { deployment: { status: 'FAILED', errorMessage: 'Build failed with exit code 1' } } });
  });

  it('fails with a timeout error once the deadline passes', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const deployment = await seedDeployment(h, project.id, { status: 'BUILDING' });
    const { operation } = await (await start(deployment.id, { timeoutSeconds: 5 })).json();
    await h.db.update(schema.connectorOperations).set({ deadlineAt: new Date(Date.now() - 1000) }).where(eq(schema.connectorOperations.id, operation.id));
    expect((await poll(operation.id)).body).toMatchObject({ status: 'failed', error: { code: 'timeout' } });
  });

  it('is owned by its grant, needs deployments:read and rejects foreign deployments and long timeouts', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const deployment = await seedDeployment(h, project.id, { status: 'BUILDING' });
    const { operation } = await (await start(deployment.id)).json();

    const sameUser = (await connect(h, userA, orgA.id, ALL)).access;
    expect((await poll(operation.id, sameUser)).status).toBe(404); // another grant of the same user
    expect((await poll(operation.id, tokenB)).status).toBe(404);
    expect((await poll('not-a-uuid')).status).toBe(404);
    const noScope = (await connect(h, userA, orgA.id, 'orb:projects:read')).access;
    expect((await start(deployment.id, {}, { token: noScope })).status).toBe(403);

    expect((await start(deployment.id, {}, { token: tokenB })).status).toBe(404); // foreign deployment
    expect((await start(deployment.id, { timeoutSeconds: 1801 })).status).toBe(400);
  });
});

describe('idempotency (C10)', () => {
  const input = () => ({ name: 'Idem', type: 'static', repository: { fullName: 'acme/site' }, deploy: false });

  it('replays the stored response for the same key and request, running the action once', async () => {
    const first = await act('projects.create', input(), { key: 'key-1' });
    const second = await act('projects.create', input(), { key: 'key-1' });
    expect(first.status).toBe(200);
    expect(first.headers.get('idempotent-replay')).toBeNull();
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    expect(await h.db.select().from(schema.projects)).toHaveLength(1);
  });

  it('treats key order and defaults as the same request', async () => {
    const a = await act('projects.create', { deploy: false, repository: { fullName: 'acme/site' }, type: 'static', name: 'Same' }, { key: 'key-2' });
    const b = await act('projects.create', { name: 'Same', type: 'static', repository: { fullName: 'acme/site' }, deploy: false, source: 'git' }, { key: 'key-2' });
    expect(b.headers.get('idempotent-replay')).toBe('true');
    expect((await a.json()).output.project.id).toBe((await b.json()).output.project.id);
  });

  it('answers 422 idempotency_conflict for the same key with a different request', async () => {
    await act('projects.create', input(), { key: 'key-3' });
    const res = await act('projects.create', { ...input(), name: 'Other' }, { key: 'key-3' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: 'idempotency_conflict', retryable: false });
    const otherAction = await act('env.remove', { projectId: '3f6c7a0e-5f0b-4d0e-9c9e-2f4d9b1a7c11', key: 'A' }, { key: 'key-3' });
    expect(otherAction.status).toBe(422);
  });

  it('answers 409 conflict with Retry-After while the first request is still running', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const parsed = ACTIONS['env.remove'].input.parse({ projectId: project.id, key: 'A' });
    await h.db.insert(schema.connectorIdempotency).values({
      grantId: (await h.db.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.userId, userA.id)))[0]!.id,
      key: 'busy',
      requestHash: requestHash('env.remove', parsed),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const res = await act('env.remove', { projectId: project.id, key: 'A' }, { key: 'busy' });
    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBe('1');
    expect((await res.json()).error).toMatchObject({ code: 'conflict', retryable: false });
  });

  it('does not keep failed requests: the same key can be retried after the cause is fixed', async () => {
    h.github.repos = [];
    const failed = await act('projects.create', input(), { key: 'key-4' });
    expect(failed.status).toBe(404);
    h.github.repos = [REPO];
    const retried = await act('projects.create', input(), { key: 'key-4' });
    expect(retried.status).toBe(200);
    expect(retried.headers.get('idempotent-replay')).toBeNull();
  });

  it('scopes keys to the grant and validates them', async () => {
    await linkGithub(h, userB.id);
    await act('projects.create', input(), { key: 'shared' });
    const other = await act('projects.create', { ...input(), name: 'B project' }, { key: 'shared', token: tokenB });
    expect(other.status).toBe(200);
    expect(other.headers.get('idempotent-replay')).toBeNull();
    expect((await act('projects.create', input(), { key: 'k'.repeat(129) })).status).toBe(400);
    expect((await act('projects.create', input(), { key: 'bad key with spaces' })).status).toBe(400);
  });
});

describe('request handling', () => {
  it('rejects unknown actions, bad JSON, wrong shapes and oversized bodies in the CP1 error shape (C11)', async () => {
    const unknownAction = await act('nope.nothing', {});
    expect(unknownAction.status).toBe(404);
    expect((await unknownAction.json()).error.code).toBe('not_found');
    expect((await act('env.remove', {}, { raw: '{not json' })).status).toBe(400);
    expect((await act('env.remove', {}, { raw: '[1,2]' })).status).toBe(400);
    expect((await act('env.remove', {}, { raw: JSON.stringify({ inputs: {} }) })).status).toBe(400);
    const big = await act('env.set', {}, { raw: JSON.stringify({ input: { projectId: 'x', dotenv: 'A='.padEnd(1_100_000, 'x') } }) });
    expect(big.status).toBe(413);
    expect((await big.json()).error).toMatchObject({ code: 'validation_failed', retryable: false });
    const unauth = await act('env.remove', {}, { token: 'cp1_orb_nope' });
    expect(unauth.status).toBe(401);
  });
});

describe('tenant isolation and scopes for actions (C07, C08)', () => {
  it('answers 404 for ids of another team on every id-based action', async () => {
    const project = await seedProject(h, orgB.id, userB.id, { name: 'B secret', repo: 'acme/site' });
    const deployment = await seedDeployment(h, project.id, { status: 'READY' });
    const cases: Array<[ActionName, Record<string, unknown>]> = [
      ['projects.update', { projectId: project.id, name: 'Hijack' }],
      ['deployments.trigger', { projectId: project.id }],
      ['deployments.cancel', { deploymentId: deployment.id }],
      ['deployments.redeploy', { deploymentId: deployment.id }],
      ['deployments.promote', { deploymentId: deployment.id }],
      ['env.set', { projectId: project.id, vars: [{ key: 'X', value: '1' }] }],
      ['env.remove', { projectId: project.id, key: 'X' }],
      ['domains.add', { projectId: project.id, domain: 'steal.example.com' }],
      ['domains.verify', { projectId: project.id, domain: 'steal.example.com' }],
      ['domains.remove', { projectId: project.id, domain: 'steal.example.com' }],
      ['projects.waitForDeployment', { deploymentId: deployment.id }],
    ];
    for (const [name, input] of cases) {
      const res = await act(name, input);
      expect(res.status, name).toBe(404);
      expect((await res.json()).error.code, name).toBe('not_found');
    }
    expect(await h.db.select().from(schema.domains)).toHaveLength(0);
    expect(await h.db.select().from(schema.environmentVariables)).toHaveLength(0);
    const [unchanged] = await h.db.select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(unchanged!.name).toBe('B secret');
  });

  it('requires the scope of every action and names it', async () => {
    const project = await seedProject(h, orgA.id, userA.id, { repo: 'acme/site' });
    const deployment = await seedDeployment(h, project.id, { status: 'READY' });
    const inputs: Record<string, Record<string, unknown>> = {
      'projects.detectFramework': { repository: { fullName: 'acme/site' } },
      'projects.create': { name: 'N', type: 'static', repository: { fullName: 'acme/site' }, deploy: false },
      'projects.update': { projectId: project.id },
      'deployments.trigger': { projectId: project.id },
      'deployments.cancel': { deploymentId: deployment.id },
      'deployments.redeploy': { deploymentId: deployment.id },
      'deployments.promote': { deploymentId: deployment.id },
      'env.set': { projectId: project.id, vars: [{ key: 'A', value: '1' }] },
      'env.remove': { projectId: project.id, key: 'A' },
      'domains.add': { projectId: project.id, domain: 'a.example.com' },
      'domains.verify': { projectId: project.id, domain: 'a.example.com' },
      'domains.remove': { projectId: project.id, domain: 'a.example.com' },
      'projects.waitForDeployment': { deploymentId: deployment.id },
    };
    expect(Object.keys(inputs).sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const [name, input] of Object.entries(inputs)) {
      const required = ACTIONS[name as ActionName].scopes[0];
      const scope = CONNECTOR_SCOPE_NAMES.filter((s) => s !== required).join(' ');
      const { access } = await connect(h, userA, orgA.id, scope);
      const res = await act(name, input, { token: access });
      expect(res.status, name).toBe(403);
      expect((await res.json()).error, name).toMatchObject({ code: 'insufficient_scope', requiredScope: required });
    }
  });

  it('applies a role downgrade to actions on the next call (C09)', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    const admin = await seedUser(h);
    await setRole(h, orgA.id, admin.id, 'admin');
    const adminToken = (await connect(h, admin, orgA.id, ALL)).access;
    expect((await act('domains.add', { projectId: project.id, domain: 'ok.example.com' }, { token: adminToken })).status).toBe(200);
    await setRole(h, orgA.id, admin.id, 'viewer');
    for (const [name, input] of [
      ['domains.add', { projectId: project.id, domain: 'no.example.com' }],
      ['env.set', { projectId: project.id, vars: [{ key: 'A', value: '1' }] }],
      ['deployments.trigger', { projectId: project.id }],
    ] as const) {
      expect((await act(name, input, { token: adminToken })).status, name).toBe(403);
    }
  });
});

describe('audit trail', () => {
  it('records every action with client, grant, action name and request id — and no payloads', async () => {
    const project = (await createSite({ deploy: false })).output.project;
    await ok('env.set', { projectId: project.id, vars: [{ key: 'SECRET_ONE', value: 'hunter2-hunter2', sensitive: true }] });
    await ok('domains.add', { projectId: project.id, domain: 'audit.example.com' });
    const rows = (await h.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, orgA.id))).filter((r) => r.via === 'connector' && r.action !== 'connector.grant_created' && r.action !== 'connector.consent_given');
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
    expect(Object.keys(byAction)).toEqual(expect.arrayContaining(['project.create', 'env.set', 'domain.add']));
    for (const row of rows) {
      expect(row).toMatchObject({ actorId: userA.id, actorType: 'connector', clientId: 'test-hub' });
      expect(row.grantId).toBeTruthy();
      expect(row.requestId).toMatch(/^req_/);
      expect((row.metadata as { connectorAction?: string }).connectorAction).toBeTruthy();
    }
    expect(byAction['env.set']!.metadata).toMatchObject({ connectorAction: 'env.set', keys: ['SECRET_ONE'] });
    expect(JSON.stringify(rows)).not.toContain('hunter2');
    // the dashboard's audit view of "who": connector rows are distinguishable from user rows
    const userRows = await h.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgA.id), eq(schema.auditLogs.actorType, 'user')));
    expect(userRows).toHaveLength(0);
  });
});
