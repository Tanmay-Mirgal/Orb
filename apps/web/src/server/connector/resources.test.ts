import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from 'database/src/schema';

vi.mock('@/lib/db', async () => (await import('./testing/harness')).dbModule());
vi.mock('@/lib/auth', async () => (await import('./testing/harness')).authModule());
vi.mock('@/server/infra', async () => (await import('./testing/harness')).infraModule());
vi.mock('core', async (importOriginal) => (await import('./testing/harness')).coreOverrides(await importOriginal()));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { encryptSecret } from 'core';
import { CONNECTOR_SCOPE_NAMES, RESOURCES, type ConnectorScope } from 'shared';
import * as R from './resources';
import {
  HUB_ENV,
  RESET_SQL,
  harness,
  linkGithub,
  seedDeployment,
  seedDomain,
  seedOrg,
  seedProject,
  seedUser,
  setRole,
  type Harness,
  type TestUser,
} from './testing/harness';
import { connect } from './testing/flow';

type AnyRoute = (req: Request, ctx: never) => Promise<Response>;

let h: Harness;
let userA: TestUser;
let userB: TestUser;
let orgA: Awaited<ReturnType<typeof seedOrg>>;
let orgB: Awaited<ReturnType<typeof seedOrg>>;
let tokenA: string;
let tokenB: string;

const ALL = CONNECTOR_SCOPE_NAMES.join(' ');

/** Calls a route handler the way Next does, with an optional `[id]` param and extra headers. */
async function invoke(handler: AnyRoute, path: string, token: string | undefined, id?: string, headers: Record<string, string> = {}): Promise<Response> {
  const all: Record<string, string> = { ...headers };
  if (token) all.authorization = `Bearer ${token}`;
  const run = handler as unknown as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const params: Record<string, string> = id ? { id } : {};
  return run(new Request(`https://orb.example.com${path}`, { headers: all }), { params: Promise.resolve(params) });
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(HUB_ENV)) vi.stubEnv(k, v);
  h = await harness();
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  h.redis.flush();
  h.session.user = null;
  h.github.repos = [];
  await h.client.exec(RESET_SQL);
  userA = await seedUser(h, { name: 'Ann A' });
  userB = await seedUser(h, { name: 'Ben B' });
  orgA = await seedOrg(h, userA.id, 'Team A');
  orgB = await seedOrg(h, userB.id, 'Team B');
  tokenA = (await connect(h, userA, orgA.id, ALL)).access;
  tokenB = (await connect(h, userB, orgB.id, ALL)).access;
});

describe('tenant isolation (C08)', () => {
  it('answers 404 not_found — never 403 — for ids that belong to another team, on every id-based resource', async () => {
    const project = await seedProject(h, orgB.id, userB.id, { name: 'Secret B' });
    const deployment = await seedDeployment(h, project.id);
    await seedDomain(h, project.id, 'secret-b.example.com');
    const targets: Array<[string, AnyRoute, string, string]> = [
      ['projects.get', R.projectsGet, `/api/connect/v1/projects/${project.id}`, project.id],
      ['projects.deployments', R.projectDeployments, `/api/connect/v1/projects/${project.id}/deployments`, project.id],
      ['projects.runtimeLogs', R.projectRuntimeLogs, `/api/connect/v1/projects/${project.id}/runtime-logs`, project.id],
      ['projects.analytics', R.projectAnalytics, `/api/connect/v1/projects/${project.id}/analytics`, project.id],
      ['projects.domains', R.projectDomains, `/api/connect/v1/projects/${project.id}/domains`, project.id],
      ['projects.env', R.projectEnv, `/api/connect/v1/projects/${project.id}/env`, project.id],
      ['deployments.get', R.deploymentsGet, `/api/connect/v1/deployments/${deployment.id}`, deployment.id],
      ['deployments.logs', R.deploymentLogs, `/api/connect/v1/deployments/${deployment.id}/logs`, deployment.id],
    ];
    for (const [name, handler, path, id] of targets) {
      const res = await invoke(handler, path, tokenA, id);
      expect(res.status, name).toBe(404);
      expect((await res.json()).error.code, name).toBe('not_found');
    }
    // the team that owns them can read them
    expect((await invoke(R.projectsGet, '/p', tokenB, project.id)).status).toBe(200);
    expect((await invoke(R.deploymentsGet, '/d', tokenB, deployment.id)).status).toBe(200);
  });

  it('answers the same 404 for ids that do not exist or are not ids at all (no probing)', async () => {
    const missing = await invoke(R.projectsGet, '/x', tokenA, '3f6c7a0e-5f0b-4d0e-9c9e-2f4d9b1a7c11');
    const junk = await invoke(R.projectsGet, '/x', tokenA, 'not-a-uuid');
    expect(missing.status).toBe(404);
    expect(junk.status).toBe(404);
    expect((await missing.json()).error).toMatchObject({ code: 'not_found', message: 'Project not found' });
    expect((await junk.json()).error).toMatchObject({ code: 'not_found', message: 'Project not found' });
  });

  it('lists only the pinned team', async () => {
    await seedProject(h, orgA.id, userA.id, { name: 'Alpha' });
    await seedProject(h, orgB.id, userB.id, { name: 'Beta' });
    const a = await (await invoke(R.projectsList, '/api/connect/v1/projects', tokenA)).json();
    const b = await (await invoke(R.projectsList, '/api/connect/v1/projects', tokenB)).json();
    expect(a.items.map((p: { name: string }) => p.name)).toEqual(['Alpha']);
    expect(b.items.map((p: { name: string }) => p.name)).toEqual(['Beta']);
    const orgs = await (await invoke(R.orgsList, '/api/connect/v1/orgs', tokenA)).json();
    expect(orgs.items.map((o: { id: string }) => o.id)).toEqual([orgA.id]);
  });

  it('keeps a user who belongs to several teams inside the team the grant is pinned to', async () => {
    const other = await seedOrg(h, userA.id, 'Also A');
    await seedProject(h, other.id, userA.id, { name: 'In other team' });
    const { items } = await (await invoke(R.projectsList, '/api/connect/v1/projects', tokenA)).json();
    expect(items).toEqual([]);
  });
});

describe('scope enforcement (C07)', () => {
  it('requires the scope of every resource and names it in requiredScope', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const deployment = await seedDeployment(h, project.id);
    const table: Record<string, [AnyRoute, string, string?]> = {
      'orgs.list': [R.orgsList, '/o'],
      'projects.list': [R.projectsList, '/p'],
      'projects.get': [R.projectsGet, '/p', project.id],
      'projects.deployments': [R.projectDeployments, '/p', project.id],
      'deployments.get': [R.deploymentsGet, '/d', deployment.id],
      'deployments.logs': [R.deploymentLogs, '/d', deployment.id],
      'projects.runtimeLogs': [R.projectRuntimeLogs, '/p', project.id],
      'projects.analytics': [R.projectAnalytics, '/p', project.id],
      'projects.domains': [R.projectDomains, '/p', project.id],
      'projects.env': [R.projectEnv, '/p', project.id],
      'github.repos': [R.githubRepos, '/g'],
      'github.branches': [R.githubBranches, '/g?repo=a/b'],
      'usage.get': [R.usageGet, '/u'],
    };
    expect(Object.keys(table).sort()).toEqual(Object.keys(RESOURCES).sort());
    for (const [name, [handler, path, id]] of Object.entries(table)) {
      const required = RESOURCES[name as keyof typeof RESOURCES].scopes[0] as ConnectorScope;
      const scope = CONNECTOR_SCOPE_NAMES.filter((s) => s !== required).join(' ');
      const { access } = await connect(h, userA, orgA.id, scope);
      const res = await invoke(handler, path, access, id);
      expect(res.status, name).toBe(403);
      expect((await res.json()).error, name).toMatchObject({ code: 'insufficient_scope', requiredScope: required, retryable: false });
    }
  });

  it('checks the scope before looking at ids (a missing scope never reveals whether an id exists)', async () => {
    const { access } = await connect(h, userA, orgA.id, 'orb:projects:read');
    expect((await invoke(R.deploymentsGet, '/d', access, '3f6c7a0e-5f0b-4d0e-9c9e-2f4d9b1a7c11')).status).toBe(403);
  });

  it('keeps reading after a downgrade to viewer (C09)', async () => {
    const admin = await seedUser(h);
    await setRole(h, orgA.id, admin.id, 'admin');
    const { access } = await connect(h, admin, orgA.id, 'orb:projects:read orb:domains:write');
    await setRole(h, orgA.id, admin.id, 'viewer');
    expect((await invoke(R.projectsList, '/p', access)).status).toBe(200);
  });
});

describe('projects and deployments', () => {
  it('returns explicit entities with deep links, never internal columns', async () => {
    const project = await seedProject(h, orgA.id, userA.id, {
      name: 'Blog',
      type: 'web_service',
      port: 4000,
      repo: 'acme/blog',
      metadata: { a: 1 },
      externalRef: { hubProjectId: 'hp1' },
      createdVia: 'connector',
    });
    const body = await (await invoke(R.projectsGet, '/p', tokenA, project.id)).json();
    expect(body).toMatchObject({
      id: project.id,
      name: 'Blog',
      type: 'web_service',
      source: 'git',
      port: 4000,
      repository: { fullName: 'acme/blog', branch: 'main' },
      metadata: { a: 1 },
      externalRef: { hubProjectId: 'hp1' },
      createdVia: 'connector',
      sleeping: false,
    });
    expect(body.webUrl).toBe(`https://orb.example.com/dashboard/projects/${project.slug}`);
    expect(body.url).toContain(project.slug);
    for (const internal of ['userId', 'orgId', 'sourceType', 'dockerImage']) expect(body).not.toHaveProperty(internal);
  });

  it('maps deployments: status, trigger names, build duration, live flag and error', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const live = await seedDeployment(h, project.id, {
      trigger: 'git_push',
      commitHash: 'abc1234',
      commitMessage: 'Fix bug',
      commitAuthor: 'ann',
      buildStartedAt: new Date('2026-01-01T10:00:00Z'),
      buildFinishedAt: new Date('2026-01-01T10:01:30Z'),
      externalRef: { hubRunId: 'run1' },
    });
    await h.db.update(schema.projects).set({ currentDeploymentId: live.id }).where(eq(schema.projects.id, project.id));
    const failed = await seedDeployment(h, project.id, { status: 'FAILED', errorMessage: 'Build failed with exit code 1', trigger: 'api' });

    const a = await (await invoke(R.deploymentsGet, '/d', tokenA, live.id)).json();
    expect(a).toMatchObject({
      status: 'READY',
      triggeredBy: 'push',
      commitSha: 'abc1234',
      branch: 'main',
      isCurrent: true,
      buildDurationMs: 90_000,
      environment: 'production',
      externalRef: { hubRunId: 'run1' },
      errorMessage: null,
    });
    expect(a.url).toContain(`dep-${live.id.slice(0, 8)}`);
    expect(a.webUrl).toContain(`deployment=${live.id}`);
    const b = await (await invoke(R.deploymentsGet, '/d', tokenA, failed.id)).json();
    expect(b).toMatchObject({ status: 'FAILED', triggeredBy: 'api', isCurrent: false, errorMessage: 'Build failed with exit code 1', buildDurationMs: null });
    expect(JSON.stringify(a)).not.toMatch(/imageRef|"config"|createdBy/);
  });

  it('filters and searches projects, treating % and _ literally', async () => {
    await seedProject(h, orgA.id, userA.id, { name: 'Landing page', type: 'static' });
    await seedProject(h, orgA.id, userA.id, { name: 'Billing API', type: 'web_service' });
    const names = async (qs: string) => (await (await invoke(R.projectsList, `/api/connect/v1/projects?${qs}`, tokenA)).json()).items.map((p: { name: string }) => p.name);
    expect(await names('type=web_service')).toEqual(['Billing API']);
    expect(await names('query=land')).toEqual(['Landing page']);
    expect(await names('query=%25')).toEqual([]);
  });

  it('filters deployments by environment and status and rejects unknown values', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    await seedDeployment(h, project.id, { environment: 'preview', status: 'READY' });
    await seedDeployment(h, project.id, { environment: 'production', status: 'FAILED' });
    const count = async (qs: string) => (await (await invoke(R.projectDeployments, `/p?${qs}`, tokenA, project.id)).json()).items.length;
    expect(await count('')).toBe(2);
    expect(await count('environment=preview')).toBe(1);
    expect(await count('status=FAILED')).toBe(1);
    expect((await invoke(R.projectDeployments, '/p?status=NOPE', tokenA, project.id)).status).toBe(400);
  });
});

describe('pagination (C12)', () => {
  type Page = { items: Array<{ name: string }>; nextCursor: string | null };

  it('walks every item exactly once with opaque cursors, newest first', async () => {
    for (let i = 0; i < 7; i++) await seedProject(h, orgA.id, userA.id, { name: `Project ${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page = await (await invoke(R.projectsList, `/api/connect/v1/projects?limit=3${cursor ? `&cursor=${cursor}` : ''}`, tokenA)).json();
      seen.push(...page.items.map((p) => p.name));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(['Project 6', 'Project 5', 'Project 4', 'Project 3', 'Project 2', 'Project 1', 'Project 0']);
  });

  it('is stable when rows are inserted between pages: nothing is repeated or skipped', async () => {
    for (let i = 0; i < 5; i++) await seedProject(h, orgA.id, userA.id, { name: `Old ${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
    const first: Page = await (await invoke(R.projectsList, '/api/connect/v1/projects?limit=2', tokenA)).json();
    await seedProject(h, orgA.id, userA.id, { name: 'Brand new', createdAt: new Date(Date.UTC(2026, 5, 1)) });
    const seen = first.items.map((p) => p.name);
    let cursor = first.nextCursor;
    while (cursor) {
      const page: Page = await (await invoke(R.projectsList, `/api/connect/v1/projects?limit=2&cursor=${cursor}`, tokenA)).json();
      seen.push(...page.items.map((p) => p.name));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['Old 4', 'Old 3', 'Old 2', 'Old 1', 'Old 0']);
  });

  it('rejects limits beyond 200, a limit of 0 and tampered cursors', async () => {
    const tooMany = await invoke(R.projectsList, '/api/connect/v1/projects?limit=201', tokenA);
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toMatchObject({ code: 'validation_failed', details: [{ path: 'limit' }] });
    expect((await invoke(R.projectsList, '/api/connect/v1/projects?limit=0', tokenA)).status).toBe(400);
    expect((await invoke(R.projectsList, '/api/connect/v1/projects?cursor=%25%25', tokenA)).status).toBe(400);
    const forged = Buffer.from(JSON.stringify({ t: 'x', id: "1'; drop table projects;--" })).toString('base64url');
    expect((await invoke(R.projectsList, `/api/connect/v1/projects?cursor=${forged}`, tokenA)).status).toBe(400);
  });

  it('rejects unknown query parameters unless the caller opts in with Prefer', async () => {
    expect((await invoke(R.projectsList, '/api/connect/v1/projects?bogus=1', tokenA)).status).toBe(400);
    expect((await invoke(R.projectsList, '/api/connect/v1/projects?bogus=1', tokenA, undefined, { prefer: 'unknown-fields=ignore' })).status).toBe(200);
  });
});

describe('environment variables and domains', () => {
  it('returns values only for non-sensitive variables and never ciphertext', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    await h.db.insert(schema.environmentVariables).values([
      { projectId: project.id, key: 'PUBLIC_URL', value: encryptSecret('https://x.test', `${project.id}:PUBLIC_URL`), isSecret: false, target: 'all', scope: 'both' },
      { projectId: project.id, key: 'API_KEY', value: encryptSecret('super-secret-value', `${project.id}:API_KEY`), isSecret: true, target: 'production', scope: 'runtime' },
    ]);
    const raw = await (await invoke(R.projectEnv, '/e', tokenA, project.id)).text();
    const body = JSON.parse(raw);
    expect(body.items).toHaveLength(2);
    const byKey = Object.fromEntries(body.items.map((i: { key: string }) => [i.key, i]));
    expect(byKey.PUBLIC_URL).toMatchObject({ value: 'https://x.test', sensitive: false, target: 'all', scope: 'both' });
    expect(byKey.API_KEY).toMatchObject({ value: null, sensitive: true, target: 'production', scope: 'runtime' });
    expect(raw).not.toContain('super-secret-value');
    expect(raw).not.toContain('enc:v1');
  });

  it('lists domains with the DNS records to create', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    await seedDomain(h, project.id, 'www.example.com', { status: 'pending' });
    const body = await (await invoke(R.projectDomains, '/d', tokenA, project.id)).json();
    expect(body.items[0]).toMatchObject({ id: 'www.example.com', domain: 'www.example.com', status: 'pending', verified: false });
    expect(body.items[0].instructions[0]).toMatchObject({ type: 'CNAME', host: 'www.example.com', purpose: 'routing' });
    expect(JSON.stringify(body)).not.toContain('verificationToken');
  });
});

describe('logs', () => {
  it('returns build log pages with a cursor and reports completion', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const ready = await seedDeployment(h, project.id, { status: 'READY' });
    expect(await (await invoke(R.deploymentLogs, '/l', tokenA, ready.id)).json()).toMatchObject({ items: [], done: true, nextCursor: null, status: 'READY' });
    const building = await seedDeployment(h, project.id, { status: 'BUILDING' });
    const live = await (await invoke(R.deploymentLogs, '/l', tokenA, building.id)).json();
    expect(live.done).toBe(false);
    expect(typeof live.nextCursor).toBe('string'); // keep polling
    expect((await invoke(R.deploymentLogs, '/l?cursor=zzz', tokenA, building.id)).status).toBe(400);
  });

  it('answers an empty runtime log for a project that never ran', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    expect(await (await invoke(R.projectRuntimeLogs, '/r', tokenA, project.id)).json()).toEqual({ deploymentId: null, items: [], nextCursor: null });
  });
});

describe('analytics, usage and organisation', () => {
  it('returns a zero-filled hourly series and totals', async () => {
    const project = await seedProject(h, orgA.id, userA.id);
    const bucket = new Date();
    bucket.setUTCMinutes(0, 0, 0);
    await h.db.insert(schema.usageHourly).values({ projectId: project.id, bucket, requests: 10, bytesOut: 2048, status2xx: 9, status5xx: 1, durationMsTotal: 500 });
    const body = await (await invoke(R.projectAnalytics, '/a?range=7d', tokenA, project.id)).json();
    expect(body.range).toBe('7d');
    expect(body.series).toHaveLength(168);
    expect(body.totals).toMatchObject({ requests: 10, bytesOut: 2048, s2xx: 9, s5xx: 1, avgMs: 50 });
    expect((await invoke(R.projectAnalytics, '/a?range=1y', tokenA, project.id)).status).toBe(400);
  });

  it('reports quotas against usage and the team with the connecting user role', async () => {
    await seedProject(h, orgA.id, userA.id, { type: 'web_service' });
    const usage = await (await invoke(R.usageGet, '/u', tokenA)).json();
    expect(usage.plan).toEqual({ id: 'pro', name: 'Pro' });
    expect(usage.quotas).toEqual(
      expect.arrayContaining([{ key: 'projects', label: 'Projects', used: 1, limit: 50 }, expect.objectContaining({ key: 'container_projects', used: 1 })]),
    );
    const org = (await (await invoke(R.orgsList, '/o', tokenA)).json()).items[0];
    expect(org).toMatchObject({ id: orgA.id, name: 'Team A', role: 'owner', plan: { id: 'pro' } });
  });
});

describe('GitHub resources', () => {
  it('answers 412 precondition_failed with a fixUrl when GitHub is not linked', async () => {
    const res = await invoke(R.githubRepos, '/g', tokenA);
    expect(res.status).toBe(412);
    expect((await res.json()).error).toMatchObject({ code: 'precondition_failed', reason: 'github_not_connected', fixUrl: expect.stringContaining('/login'), retryable: false });
  });

  it('lists repositories newest push first and pages with a keyset cursor', async () => {
    await linkGithub(h, userA.id);
    h.github.repos = [1, 2, 3, 4, 5].map((n) => ({ id: n, full_name: `acme/repo-${n}`, default_branch: 'main', pushed_at: `2026-01-0${n}T00:00:00Z`, language: 'TypeScript' }));
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Array<{ fullName: string }>; nextCursor: string | null } = await (await invoke(R.githubRepos, `/g?limit=2${cursor ? `&cursor=${cursor}` : ''}`, tokenA)).json();
      names.push(...page.items.map((r) => r.fullName));
      cursor = page.nextCursor;
    } while (cursor);
    expect(names).toEqual(['acme/repo-5', 'acme/repo-4', 'acme/repo-3', 'acme/repo-2', 'acme/repo-1']);
    const first = (await (await invoke(R.githubRepos, '/g', tokenA)).json()).items[0];
    expect(first).toEqual({ id: 5, fullName: 'acme/repo-5', private: false, language: 'TypeScript', defaultBranch: 'main', pushedAt: '2026-01-05T00:00:00Z', ownerLogin: 'acme' });
    expect(JSON.stringify(first)).not.toMatch(/token|gho_/);
  });

  it('lists the branches of a repository', async () => {
    await linkGithub(h, userA.id);
    h.github.repos = [{ id: 1, full_name: 'acme/site', default_branch: 'main', branches: ['main', 'dev', 'feature/x'] }];
    const body = await (await invoke(R.githubBranches, '/g?repo=acme/site&limit=2', tokenA)).json();
    expect(body.items).toEqual([{ name: 'dev' }, { name: 'feature/x' }]);
    const next = await (await invoke(R.githubBranches, `/g?repo=acme/site&limit=2&cursor=${body.nextCursor}`, tokenA)).json();
    expect(next).toEqual({ items: [{ name: 'main' }], nextCursor: null });
    expect((await invoke(R.githubBranches, '/g?repo=bad', tokenA)).status).toBe(400);
  });
});

describe('auditing reads', () => {
  it('records connector reads at most once a minute per grant and resource, without payloads', async () => {
    await invoke(R.projectsList, '/p', tokenA);
    await invoke(R.projectsList, '/p', tokenA);
    await invoke(R.usageGet, '/u', tokenA);
    await new Promise((r) => setTimeout(r, 100));
    const reads = (await h.db.select().from(schema.auditLogs)).filter((r) => r.action === 'connector.read' && r.orgId === orgA.id);
    expect(reads.map((r) => (r.metadata as { connectorAction: string }).connectorAction).sort()).toEqual(['projects.list', 'usage.get']);
    expect(reads[0]).toMatchObject({ via: 'connector', actorId: userA.id, actorType: 'connector' });
    expect(reads[0]!.grantId).toBeTruthy();
    expect(reads[0]!.requestId).toMatch(/^req_/);
  });
});
