import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from 'database/src/schema';
import { MIGRATIONS_FOLDER } from 'database/src/migrate';

/**
 * Test harness for the connector: a real Postgres (PGlite, all migrations applied), plus in-memory stand-ins for the
 * things the routes reach through `@/lib/db`, `@/lib/auth`, `@/server/infra` and GitHub. Each test file mocks those
 * modules with the `*Module()` factories below, so the real route handlers and services run unchanged.
 *
 * PGlite has ONE connection: inside `db.transaction` code must only use `tx` (a second query on `db` would wait forever).
 */

export class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private entry(key: string) {
    const e = this.store.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string) {
    return this.entry(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    const nx = args.includes('NX');
    if (nx && this.entry(key)) return null;
    const ex = args.indexOf('EX');
    this.store.set(key, { value, expiresAt: ex >= 0 ? Date.now() + Number(args[ex + 1]) * 1000 : null });
    return 'OK';
  }

  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys.flat()) if (this.store.delete(k)) n++;
    return n;
  }

  async mget(...keys: Array<string | string[]>) {
    return keys.flat().map((k) => this.entry(k)?.value ?? null);
  }

  async getdel(key: string) {
    const v = this.entry(key)?.value ?? null;
    this.store.delete(key);
    return v;
  }

  async incr(key: string) {
    const next = Number(this.entry(key)?.value ?? 0) + 1;
    const existing = this.entry(key);
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number, mode?: string) {
    const e = this.entry(key);
    if (!e) return 0;
    if (mode === 'NX' && e.expiresAt !== null) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string) {
    const e = this.entry(key);
    return e?.expiresAt ? Math.ceil((e.expiresAt - Date.now()) / 1000) : -1;
  }

  async publish() {
    return 0;
  }

  async ping() {
    return 'PONG';
  }

  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      incr: (key: string) => (ops.push(() => this.incr(key)), chain),
      expire: (key: string, seconds: number, mode?: string) => (ops.push(() => this.expire(key, seconds, mode)), chain),
      exec: async () => {
        const out: Array<[null, unknown]> = [];
        for (const op of ops) out.push([null, await op()]);
        return out;
      },
    };
    return chain;
  }

  flush() {
    this.store.clear();
  }
}

export class FakeQueue {
  jobs: Array<{ name: string; data: unknown; opts?: unknown }> = [];
  removed: string[] = [];
  async add(name: string, data: unknown, opts?: unknown) {
    this.jobs.push({ name, data, opts });
    return { id: `${name}-${this.jobs.length}` };
  }
  async getJob() {
    return null;
  }
  clear() {
    this.jobs = [];
  }
}

export interface FakeRepo {
  id: number;
  full_name: string;
  default_branch: string;
  private?: boolean;
  language?: string | null;
  pushed_at?: string | null;
  /** path -> file contents, for framework detection */
  files?: Record<string, string>;
  branches?: string[];
}

export interface GithubState {
  validTokens: Set<string>;
  login: string;
  repos: FakeRepo[];
  /** Repositories the Orb GitHub App is installed on. */
  installed: Set<string>;
  calls: Array<{ token: string; path: string }>;
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function makeGithubFetch(state: GithubState) {
  return async (token: string, path: string): Promise<Response> => {
    state.calls.push({ token, path });
    const url = new URL(path, 'https://api.github.com');
    const appJwt = token.split('.').length === 3;
    if (!appJwt && !state.validTokens.has(token)) return jsonResponse({ message: 'Bad credentials' }, 401);
    if (url.pathname === '/user') return jsonResponse({ login: state.login });
    if (url.pathname === '/user/repos') return jsonResponse(state.repos.map(repoView));
    const installation = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(url.pathname);
    if (installation) return state.installed.has(installation[1]!.toLowerCase()) ? jsonResponse({ id: 4242 }) : jsonResponse({ message: 'Not Found' }, 404);
    const branches = /^\/repos\/([^/]+\/[^/]+)\/branches$/.exec(url.pathname);
    if (branches) {
      const repo = state.repos.find((r) => r.full_name.toLowerCase() === branches[1]!.toLowerCase());
      return repo ? jsonResponse((repo.branches ?? [repo.default_branch]).map((name) => ({ name }))) : jsonResponse({ message: 'Not Found' }, 404);
    }
    const contents = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(url.pathname);
    if (contents) {
      const repo = state.repos.find((r) => r.full_name.toLowerCase() === contents[1]!.toLowerCase());
      const file = repo?.files?.[decodeURIComponent(contents[2]!)];
      return file === undefined ? jsonResponse({ message: 'Not Found' }, 404) : jsonResponse({ type: 'file', encoding: 'base64', content: Buffer.from(file).toString('base64') });
    }
    const one = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname);
    if (one) {
      const repo = state.repos.find((r) => r.full_name.toLowerCase() === one[1]!.toLowerCase());
      return repo ? jsonResponse(repoView(repo)) : jsonResponse({ message: 'Not Found' }, 404);
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };
}

function repoView(r: FakeRepo) {
  return {
    id: r.id,
    name: r.full_name.split('/')[1],
    full_name: r.full_name,
    private: r.private ?? false,
    language: r.language ?? null,
    default_branch: r.default_branch,
    updated_at: '2026-01-01T00:00:00Z',
    pushed_at: r.pushed_at ?? '2026-01-01T00:00:00Z',
    owner: { login: r.full_name.split('/')[0], avatar_url: '' },
  };
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
}

export interface Harness {
  client: PGlite;
  db: PgliteDatabase<typeof schema>;
  redis: FakeRedis;
  queues: { build: FakeQueue; release: FakeQueue; maintenance: FakeQueue };
  session: { user: TestUser | null };
  github: GithubState;
}

let instance: Promise<Harness> | undefined;

async function create(): Promise<Harness> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    client,
    db,
    redis: new FakeRedis(),
    queues: { build: new FakeQueue(), release: new FakeQueue(), maintenance: new FakeQueue() },
    session: { user: null },
    github: { validTokens: new Set(), login: 'octocat', repos: [], installed: new Set(), calls: [] },
  };
}

/** One harness (one PGlite, migrations applied once) per test file. */
export function harness(): Promise<Harness> {
  return (instance ??= create());
}

// --- module factories for vi.mock ------------------------------------------------------------------------------------

export async function dbModule() {
  const h = await harness();
  return { db: h.db, pg: null };
}

export async function authModule() {
  const h = await harness();
  return { auth: { api: { getSession: async () => (h.session.user ? { user: h.session.user, session: { id: 'session' } } : null) } } };
}

export async function infraModule() {
  const h = await harness();
  return {
    getRedis: () => h.redis,
    getBuildQueue: () => h.queues.build,
    getReleaseQueue: () => h.queues.release,
    getMaintenanceQueue: () => h.queues.maintenance,
    getLogStore: () => ({ readBuild: async () => ({ lines: [], next: 0 }), readRuntime: async () => ({ entries: [], last: undefined }) }),
    getStorage: () => ({ get: async () => null }),
  };
}

export async function coreOverrides(actual: Record<string, unknown>) {
  const h = await harness();
  return { ...actual, githubFetch: makeGithubFetch(h.github) };
}

// --- seeding -----------------------------------------------------------------------------------------------------------

export async function seedUser(h: Harness, overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const id = overrides.id ?? `u_${randomUUID().slice(0, 8)}`;
  const user = { id, name: overrides.name ?? `User ${id}`, email: overrides.email ?? `${id}@example.com` };
  const now = new Date();
  await h.db.insert(schema.users).values({ ...user, emailVerified: true, createdAt: now, updatedAt: now });
  return user;
}

export async function seedOrg(h: Harness, ownerId: string, name = 'Acme', plan = 'pro') {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`;
  const [org] = await h.db.insert(schema.organizations).values({ name, slug, plan, createdBy: ownerId }).returning();
  await h.db.insert(schema.memberships).values({ orgId: org!.id, userId: ownerId, role: 'owner' });
  return org!;
}

export async function setRole(h: Harness, orgId: string, userId: string, role: string) {
  await h.db
    .insert(schema.memberships)
    .values({ orgId, userId, role })
    .onConflictDoUpdate({ target: [schema.memberships.orgId, schema.memberships.userId], set: { role } });
}

export async function removeMember(h: Harness, orgId: string, userId: string) {
  const { and, eq } = await import('drizzle-orm');
  await h.db.delete(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
}

export async function linkGithub(h: Harness, userId: string, token = `gho_${userId}`) {
  await h.db.insert(schema.accounts).values({ id: `acc_${randomUUID().slice(0, 8)}`, accountId: `gh_${userId}`, providerId: 'github', userId, accessToken: token });
  h.github.validTokens.add(token);
  return token;
}

export const HUB_ENV = {
  CONNECTOR_ENABLED: 'true',
  CONNECTOR_HUB_NAME: 'Test Hub',
  CONNECTOR_HUB_CLIENT_ID: 'test-hub',
  CONNECTOR_HUB_CLIENT_SECRET: 'hub-secret-hub-secret-hub-secret-123456',
  CONNECTOR_HUB_REDIRECT_URIS: 'https://hub.example.com/callback,http://localhost:3100/callback',
  CONNECTOR_TOKEN_PEPPER: 'pepper-pepper-pepper-pepper-pepper-1234',
  CONNECTOR_ENCRYPTION_KEY: 'encryption-key-encryption-key-123456789',
  NEXT_PUBLIC_APP_URL: 'https://orb.example.com',
  BETTER_AUTH_URL: 'https://orb.example.com',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  GITHUB_APP_INSTALLATION_URL: 'https://github.com/apps/orb-test',
} as const;
