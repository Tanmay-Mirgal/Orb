import type { z } from 'zod';
import {
  and,
  asc,
  deployments,
  desc,
  eq,
  gte,
  ilike,
  instances,
  projectRepositories,
  projects,
  toDeploymentEntity,
  toProjectEntity,
  usageHourly,
} from 'database';
import { storageKeys } from 'storage';
import { RESOURCES, TERMINAL_DEPLOYMENT_STATUSES, cpValidation, getOrgPlan, type DeploymentStatus, type ResourceName } from 'shared';
import { db } from '@/lib/db';
import { getUserGithubToken, listBranches, listRepos } from '../github';
import { getLogStore, getRedis, getStorage } from '../infra';
import { listEnvVars } from '../services/env';
import { listProjectDomains } from '../services/domains';
import { auditConnectorCall } from './audit';
import { connectAuthed, type AuthedContext } from './auth';
import { pinnedDeployment, pinnedProject } from './data';
import { toDomainEntity, toEnvVarEntity, toOrgEntity } from './entities';
import { decodeCursorObject, decodeKeyset, encodeCursor, keysetAfter, keysetOrder, toPage } from './pagination';
import { parseQuery } from './validate';
import { loadOrgUsage, quotas } from './usage';

type Query<N extends ResourceName> = z.infer<(typeof RESOURCES)[N]['query']>;

/** At most one audit row per grant and resource per minute: reads are polled, and they must not flood the log. */
async function auditRead(ctx: AuthedContext<Record<string, string>>, name: string): Promise<void> {
  try {
    const first = await getRedis().set(`cp1:audit:${ctx.auth.connector.grantId}:${name}`, '1', 'EX', 60, 'NX');
    if (first) await auditConnectorCall(ctx.auth, name, { orgId: ctx.auth.org.id, action: 'connector.read', targetType: 'resource', targetId: name });
  } catch {
    /* auditing is best effort */
  }
}

/** Scope(s) and query schema come from the registry, so the manifest and the runtime cannot drift apart. */
function resource<N extends ResourceName, P extends Record<string, string> = Record<string, never>>(
  name: N,
  handler: (ctx: AuthedContext<P> & { query: Query<N> }) => Promise<unknown>,
) {
  const def = RESOURCES[name];
  return connectAuthed<P>({ scope: def.scopes }, async (ctx) => {
    const query = parseQuery(def.query as unknown as z.ZodType<Query<N>>, ctx.req);
    const result = await handler({ ...ctx, query });
    void auditRead(ctx as unknown as AuthedContext<Record<string, string>>, name);
    return result;
  });
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const orgsList = resource('orgs.list', async ({ auth }) => ({ items: [toOrgEntity(auth.org, auth.role)], nextCursor: null }));

export const projectsList = resource('projects.list', async ({ auth, query }) => {
  const cursor = decodeKeyset(query.cursor);
  const filters = [eq(projects.orgId, auth.org.id)];
  if (query.type) filters.push(eq(projects.type, query.type));
  if (query.query) filters.push(ilike(projects.name, like(query.query)));
  const after = keysetAfter(projects.createdAt, projects.id, cursor);
  if (after) filters.push(after);
  const rows = await db
    .select({ project: projects, repository: projectRepositories })
    .from(projects)
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .where(and(...filters))
    .orderBy(...keysetOrder(projects.createdAt, projects.id))
    .limit(query.limit + 1);
  return toPage(
    rows.map((r) => ({ ...r, createdAt: r.project.createdAt, id: r.project.id })),
    query.limit,
    (r) => toProjectEntity(r.project, r.repository),
  );
});

export const projectsGet = resource<'projects.get', { id: string }>('projects.get', async ({ auth, params }) => {
  const { project, repository } = await pinnedProject(auth, params.id);
  return toProjectEntity(project, repository);
});

export const projectDeployments = resource<'projects.deployments', { id: string }>('projects.deployments', async ({ auth, params, query }) => {
  const { project } = await pinnedProject(auth, params.id);
  const filters = [eq(deployments.projectId, project.id)];
  if (query.environment) filters.push(eq(deployments.environment, query.environment));
  if (query.status) filters.push(eq(deployments.status, query.status));
  const after = keysetAfter(deployments.createdAt, deployments.id, decodeKeyset(query.cursor));
  if (after) filters.push(after);
  const rows = await db
    .select()
    .from(deployments)
    .where(and(...filters))
    .orderBy(...keysetOrder(deployments.createdAt, deployments.id))
    .limit(query.limit + 1);
  return toPage(rows, query.limit, (d) => toDeploymentEntity(d, project));
});

export const deploymentsGet = resource<'deployments.get', { id: string }>('deployments.get', async ({ auth, params }) => {
  const { deployment, project } = await pinnedDeployment(auth, params.id);
  return toDeploymentEntity(deployment, project);
});

const MAX_LOG_LINES = 1000;

async function archivedBuildLog(deploymentId: string): Promise<string[]> {
  const object = await getStorage().get(storageKeys.buildLog(deploymentId));
  if (!object) return [];
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean);
}

/** Same data as the dashboard's build log (already masked by the build worker), with an opaque line cursor. */
export const deploymentLogs = resource<'deployments.logs', { id: string }>('deployments.logs', async ({ auth, params, query }) => {
  const { deployment } = await pinnedDeployment(auth, params.id);
  let from = 0;
  if (query.cursor) {
    const n = decodeCursorObject(query.cursor).n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
    from = n;
  }
  let { lines } = await getLogStore().readBuild(deployment.id, from);
  if (lines.length === 0 && from === 0) lines = await archivedBuildLog(deployment.id).catch(() => []);
  const page = lines.slice(0, MAX_LOG_LINES);
  const next = from + page.length;
  const finished = TERMINAL_DEPLOYMENT_STATUSES.includes(deployment.status as DeploymentStatus);
  const done = finished && page.length === lines.length;
  return {
    items: page.map((text, i) => ({ index: from + i, text })),
    nextCursor: done ? null : encodeCursor({ n: next }),
    done,
    status: deployment.status,
  };
});

export const projectRuntimeLogs = resource<'projects.runtimeLogs', { id: string }>('projects.runtimeLogs', async ({ auth, params, query }) => {
  const { project } = await pinnedProject(auth, params.id);
  let deploymentId = project.currentDeploymentId;
  if (!deploymentId) {
    const [latest] = await db.select({ id: instances.deploymentId }).from(instances).where(eq(instances.projectId, project.id)).orderBy(desc(instances.createdAt)).limit(1);
    deploymentId = latest?.id ?? null;
  }
  if (!deploymentId) return { deploymentId: null, items: [], nextCursor: null };
  let after: string | undefined;
  if (query.cursor) {
    const id = decodeCursorObject(query.cursor).after;
    if (typeof id !== 'string' || !/^\d+-\d+$/.test(id)) throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
    after = id;
  }
  const { entries, last } = await getLogStore().readRuntime(deploymentId, after);
  return {
    deploymentId,
    items: entries.map((e) => ({ id: e.id, text: e.line })),
    nextCursor: last ? encodeCursor({ after: last }) : null,
  };
});

const RANGE_HOURS: Record<string, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

export const projectAnalytics = resource<'projects.analytics', { id: string }>('projects.analytics', async ({ auth, params, query }) => {
  const { project } = await pinnedProject(auth, params.id);
  const hours = RANGE_HOURS[query.range] ?? 24;
  const since = new Date(Date.now() - hours * 3_600_000);
  since.setUTCMinutes(0, 0, 0);
  const rows = await db
    .select()
    .from(usageHourly)
    .where(and(eq(usageHourly.projectId, project.id), gte(usageHourly.bucket, since)))
    .orderBy(asc(usageHourly.bucket));
  const byBucket = new Map(rows.map((r) => [r.bucket.toISOString(), r]));
  const series = Array.from({ length: hours }, (_, i) => {
    const bucket = new Date(since.getTime() + i * 3_600_000);
    const row = byBucket.get(bucket.toISOString());
    return {
      bucket: bucket.toISOString(),
      requests: row?.requests ?? 0,
      bytesOut: row?.bytesOut ?? 0,
      errors: row?.status5xx ?? 0,
      avgMs: row && row.requests > 0 ? Math.round(row.durationMsTotal / row.requests) : 0,
    };
  });
  const sum = rows.reduce(
    (acc, r) => ({ requests: acc.requests + r.requests, bytesOut: acc.bytesOut + r.bytesOut, s2xx: acc.s2xx + r.status2xx, s3xx: acc.s3xx + r.status3xx, s4xx: acc.s4xx + r.status4xx, s5xx: acc.s5xx + r.status5xx, ms: acc.ms + r.durationMsTotal }),
    { requests: 0, bytesOut: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, ms: 0 },
  );
  return {
    range: query.range,
    series,
    totals: { requests: sum.requests, bytesOut: sum.bytesOut, s2xx: sum.s2xx, s3xx: sum.s3xx, s4xx: sum.s4xx, s5xx: sum.s5xx, avgMs: sum.requests ? Math.round(sum.ms / sum.requests) : 0 },
  };
});

export const projectDomains = resource<'projects.domains', { id: string }>('projects.domains', async ({ auth, params }) => {
  const { project } = await pinnedProject(auth, params.id);
  const views = await listProjectDomains(project.id);
  return { items: views.sort((a, b) => a.domain.localeCompare(b.domain)).map((v) => toDomainEntity(v, project)), nextCursor: null };
});

export const projectEnv = resource<'projects.env', { id: string }>('projects.env', async ({ auth, params }) => {
  const { project } = await pinnedProject(auth, params.id);
  return { items: (await listEnvVars(project.id)).map(toEnvVarEntity), nextCursor: null };
});

interface RepoRow {
  id: number;
  fullName: string;
  private: boolean;
  language: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  ownerLogin: string;
}

async function repositoriesOf(userId: string): Promise<RepoRow[]> {
  const key = `cp1:ghrepos:${userId}`;
  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as RepoRow[];
  } catch {
    /* cache is optional */
  }
  const token = await getUserGithubToken(userId);
  const rows: RepoRow[] = (await listRepos(token))
    .map((r) => ({ id: r.id, fullName: r.full_name, private: r.private, language: r.language, defaultBranch: r.default_branch, pushedAt: r.pushed_at, ownerLogin: r.owner.login }))
    .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '') || b.id - a.id);
  try {
    await redis.set(key, JSON.stringify(rows), 'EX', 60);
  } catch {
    /* ignore */
  }
  return rows;
}

export const githubRepos = resource('github.repos', async ({ auth, query }) => {
  const rows = await repositoriesOf(auth.userId);
  let start = 0;
  if (query.cursor) {
    const { p, i } = decodeCursorObject(query.cursor);
    if (typeof p !== 'string' || typeof i !== 'number') throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
    // Keyset on (pushedAt desc, id desc): stable even when the user pushes while paging.
    start = rows.findIndex((r) => (r.pushedAt ?? '') < p || ((r.pushedAt ?? '') === p && r.id < i));
    if (start < 0) start = rows.length;
  }
  const slice = rows.slice(start, start + query.limit);
  const last = slice[slice.length - 1];
  return { items: slice, nextCursor: last && start + query.limit < rows.length ? encodeCursor({ p: last.pushedAt ?? '', i: last.id }) : null };
});

export const githubBranches = resource('github.branches', async ({ auth, query }) => {
  const token = await getUserGithubToken(auth.userId);
  const names = (await listBranches(token, query.repo)).sort((a, b) => a.localeCompare(b));
  let start = 0;
  if (query.cursor) {
    const { n } = decodeCursorObject(query.cursor);
    if (typeof n !== 'string') throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
    start = names.findIndex((name) => name.localeCompare(n) > 0);
    if (start < 0) start = names.length;
  }
  const slice = names.slice(start, start + query.limit);
  const last = slice[slice.length - 1];
  return { items: slice.map((name) => ({ name })), nextCursor: last && start + query.limit < names.length ? encodeCursor({ n: last }) : null };
});

export const usageGet = resource('usage.get', async ({ auth }) => {
  const plan = getOrgPlan(auth.org.plan);
  return { plan: { id: plan.id, name: plan.name }, quotas: quotas(auth.org, await loadOrgUsage(auth.org.id)) };
});
