import { accounts, and, count, deployments, eq, memberships, ne, projects, type Organization } from 'database';
import { env, githubFetch } from 'core';
import { getOrgPlan } from 'shared';
import { db } from '@/lib/db';
import { getRedis } from '../infra';

export interface OrgUsage {
  projects: number;
  containerProjects: number;
  members: number;
  activeBuilds: number;
}

export async function loadOrgUsage(orgId: string): Promise<OrgUsage> {
  const [[p], [c], [m], [b]] = await Promise.all([
    db.select({ n: count() }).from(projects).where(eq(projects.orgId, orgId)),
    db.select({ n: count() }).from(projects).where(and(eq(projects.orgId, orgId), ne(projects.type, 'static'))),
    db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, orgId)),
    db
      .select({ n: count() })
      .from(deployments)
      .innerJoin(projects, eq(projects.id, deployments.projectId))
      .where(and(eq(projects.orgId, orgId), eq(deployments.status, 'BUILDING'))),
  ]);
  return { projects: p?.n ?? 0, containerProjects: c?.n ?? 0, members: m?.n ?? 0, activeBuilds: b?.n ?? 0 };
}

/** The plan limits a client can act on (never the pricing). */
export function planLimits(org: Pick<Organization, 'plan'>) {
  const plan = getOrgPlan(org.plan);
  return {
    maxProjects: plan.maxProjects,
    maxContainerProjects: plan.maxContainerProjects,
    maxMembers: plan.maxMembers,
    maxDomainsPerProject: plan.maxDomainsPerProject,
    maxInstancesPerService: plan.maxInstancesPerService,
    maxConcurrentBuilds: plan.maxConcurrentBuilds,
    buildTimeoutSec: plan.buildTimeoutSec,
    allowedInstancePlans: [...plan.allowedInstancePlans],
    previewDeployments: plan.previewDeployments,
    retainedDeployments: plan.retainedDeployments,
    apiRatePerMinute: plan.apiRatePerMinute,
  };
}

export function quotas(org: Pick<Organization, 'plan'>, usage: OrgUsage) {
  const plan = getOrgPlan(org.plan);
  return [
    { key: 'projects', label: 'Projects', used: usage.projects, limit: plan.maxProjects },
    { key: 'container_projects', label: 'Web services, workers and cron jobs', used: usage.containerProjects, limit: plan.maxContainerProjects },
    { key: 'members', label: 'Team members', used: usage.members, limit: plan.maxMembers },
    { key: 'concurrent_builds', label: 'Builds running now', used: usage.activeBuilds, limit: plan.maxConcurrentBuilds },
  ];
}

/** `https://github.com/apps/<name>/installations/new`, from the same variable the dashboard uses. */
export function githubAppInstallUrl(): string | null {
  const base = env('GITHUB_APP_INSTALLATION_URL');
  if (!base) return null;
  return /\/installations\/new\/?$/.test(base) ? base : `${base.replace(/\/+$/, '')}/installations/new`;
}

async function githubLoginOf(userId: string, token: string): Promise<string | null> {
  const key = `cp1:ghlogin:${userId}`;
  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached !== null) return cached || null;
  } catch {
    /* cache is optional */
  }
  let login: string | null = null;
  try {
    const res = await githubFetch(token, '/user');
    if (res.ok) login = ((await res.json()) as { login?: string }).login ?? null;
  } catch {
    login = null;
  }
  try {
    await redis.set(key, login ?? '', 'EX', login ? 600 : 60);
  } catch {
    /* ignore */
  }
  return login;
}

export interface Capabilities {
  githubConnected: boolean;
  githubLogin: string | null;
  githubAppInstallUrl: string | null;
  plan: string;
  role: string;
}

export async function loadCapabilities(userId: string, org: Pick<Organization, 'plan'>, role: string): Promise<Capabilities> {
  const [account] = await db
    .select({ accessToken: accounts.accessToken })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'github')))
    .limit(1);
  const token = account?.accessToken ?? null;
  return {
    githubConnected: Boolean(token),
    githubLogin: token ? await githubLoginOf(userId, token) : null,
    githubAppInstallUrl: githubAppInstallUrl(),
    plan: org.plan,
    role,
  };
}
