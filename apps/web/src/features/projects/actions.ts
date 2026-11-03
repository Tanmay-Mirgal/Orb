"use server";

import { cookies, headers } from "next/headers";
import {
  and, count, deployments, desc, domains, eq, gte, inArray, instances, isNull, memberships, notifications, organizations, projectRegistryCredentials, projectRepositories, projects, sql, usageHourly, users,
} from "database";
import { can, getOrgPlan } from "shared";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ORG_COOKIE, resolveActiveOrg } from "@/server/orgs";
import { listPayments, razorpayConfig } from "@/server/services/billing";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user;
}

/** The signed-in user plus their active team (from the `orb_org` cookie, else the personal team). */
export async function getActiveContext() {
  const user = await requireUser();
  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const active = await resolveActiveOrg({ id: user.id, name: user.name }, preferred);
  return {
    user,
    org: active.org,
    role: active.role,
    teams: active.all.map((m) => ({ id: m.org.id, name: m.org.name, slug: m.org.slug, plan: m.org.plan, role: m.role, isPersonal: m.org.isPersonal })),
  };
}

async function countUnread(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Everything the app shell needs: user, teams, palette entries and the plan meter. */
export async function getShellData() {
  const ctx = await getActiveContext();
  const rows = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug, type: projects.type })
    .from(projects)
    .where(eq(projects.orgId, ctx.org.id))
    .orderBy(desc(projects.createdAt))
    .limit(50);
  const plan = getOrgPlan(ctx.org.plan);
  return {
    user: { name: ctx.user.name, email: ctx.user.email, image: ctx.user.image ?? null },
    teams: ctx.teams.map((t) => ({ id: t.id, name: t.name, role: t.role, isPersonal: t.isPersonal })),
    activeTeamId: ctx.org.id,
    projects: rows,
    plan: { id: plan.id, name: plan.name, projects: rows.length, maxProjects: plan.maxProjects, expiresAt: ctx.org.planExpiresAt ? ctx.org.planExpiresAt.toISOString() : null, source: ctx.org.planSource },
    unreadNotifications: await countUnread(ctx.user.id),
  };
}

/** Projects of the active team, in the `{ project, repository }` shape the list components expect. */
export async function getUserProjects() {
  const { org } = await getActiveContext();
  return db
    .select({ project: projects, repository: projectRepositories })
    .from(projects)
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .where(eq(projects.orgId, org.id))
    .orderBy(desc(projects.createdAt));
}

/** Projects with their live deployment, for the project grid. */
export async function getProjectCards() {
  const { org } = await getActiveContext();
  const rows = await db
    .select({ project: projects, repository: projectRepositories, current: deployments })
    .from(projects)
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .leftJoin(deployments, eq(deployments.id, projects.currentDeploymentId))
    .where(eq(projects.orgId, org.id))
    .orderBy(desc(projects.createdAt));
  const ids = rows.map((r) => r.project.id);
  // Latest deployment per project (live one may be older than an in-flight build).
  const latestByProject = new Map<string, (typeof deployments.$inferSelect)>();
  if (ids.length > 0) {
    const recent = await db.select().from(deployments).where(inArray(deployments.projectId, ids)).orderBy(desc(deployments.createdAt)).limit(ids.length * 4);
    for (const d of recent) if (!latestByProject.has(d.projectId)) latestByProject.set(d.projectId, d);
  }
  return rows.map((r) => ({ ...r, latest: latestByProject.get(r.project.id) ?? null }));
}

export async function getOverview() {
  const { org, user, role } = await getActiveContext();
  const plan = getOrgPlan(org.plan);
  const cards = await getProjectCards();
  const ids = cards.map((c) => c.project.id);

  const recent = ids.length
    ? await db
        .select({
          id: deployments.id,
          status: deployments.status,
          environment: deployments.environment,
          branch: deployments.branch,
          commitHash: deployments.commitHash,
          commitMessage: deployments.commitMessage,
          createdAt: deployments.createdAt,
          projectName: projects.name,
          projectSlug: projects.slug,
        })
        .from(deployments)
        .innerJoin(projects, eq(projects.id, deployments.projectId))
        .where(eq(projects.orgId, org.id))
        .orderBy(desc(deployments.createdAt))
        .limit(8)
    : [];

  const [domainCount] = ids.length
    ? await db.select({ n: count() }).from(domains).where(inArray(domains.projectId, ids))
    : [{ n: 0 }];
  const [running] = ids.length
    ? await db.select({ n: count() }).from(instances).where(and(inArray(instances.projectId, ids), eq(instances.status, "RUNNING")))
    : [{ n: 0 }];

  // Requests per hour for the last 24 hours across the team (what the edge counted), as a fixed-length series.
  const HOUR = 3_600_000;
  const lastHour = Math.floor(Date.now() / HOUR) * HOUR;
  const since = new Date(lastHour - 23 * HOUR);
  const traffic = ids.length
    ? await db
        .select({ bucket: usageHourly.bucket, requests: sql<number>`sum(${usageHourly.requests})::float8`, bytes: sql<number>`sum(${usageHourly.bytesOut})::float8` })
        .from(usageHourly)
        .where(and(inArray(usageHourly.projectId, ids), gte(usageHourly.bucket, since)))
        .groupBy(usageHourly.bucket)
    : [];
  const byHour = new Map(traffic.map((t) => [t.bucket.getTime(), t]));
  const series = Array.from({ length: 24 }, (_, i) => Number(byHour.get(since.getTime() + i * HOUR)?.requests ?? 0));

  const [memberTotal] = await db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, org.id));
  const memberPreview = await db
    .select({ name: users.name, image: users.image })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, org.id))
    .limit(5);

  return {
    userName: user.name,
    orgName: org.name,
    isPersonal: org.isPersonal,
    role,
    plan: {
      id: plan.id,
      name: plan.name,
      maxProjects: plan.maxProjects,
      maxMembers: plan.maxMembers,
      expiresAt: org.planExpiresAt ? org.planExpiresAt.toISOString() : null,
      source: org.planSource,
    },
    cards,
    recent,
    live: cards.filter((c) => c.current?.status === "READY").length,
    failing: cards.filter((c) => c.latest?.status === "FAILED").length,
    sleeping: cards.filter((c) => c.project.sleepingAt).length,
    domains: domainCount?.n ?? 0,
    runningInstances: running?.n ?? 0,
    traffic: { series, requests: series.reduce((a, b) => a + b, 0), bytes: traffic.reduce((a, t) => a + Number(t.bytes ?? 0), 0) },
    members: { count: memberTotal?.n ?? 1, preview: memberPreview },
  };
}

export async function getUsage() {
  const { org, role } = await getActiveContext();
  const plan = getOrgPlan(org.plan);
  const [projectCount] = await db.select({ n: count() }).from(projects).where(eq(projects.orgId, org.id));
  const [memberCount] = await db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, org.id));
  const projectIds = (await db.select({ id: projects.id }).from(projects).where(eq(projects.orgId, org.id))).map((p) => p.id);
  const [domainCount] = projectIds.length ? await db.select({ n: count() }).from(domains).where(inArray(domains.projectId, projectIds)) : [{ n: 0 }];
  const [running] = projectIds.length
    ? await db.select({ n: count() }).from(instances).where(and(inArray(instances.projectId, projectIds), inArray(instances.status, ["RUNNING", "STARTING"])))
    : [{ n: 0 }];
  const billing = can(role, "billing:read") ? await listPayments(org.id) : [];
  return {
    org: { id: org.id, name: org.name, plan: org.plan, planSource: org.planSource, planExpiresAt: org.planExpiresAt, isPersonal: org.isPersonal },
    role,
    billingEnabled: razorpayConfig().enabled,
    payments: billing.map((p) => ({ id: p.id, plan: p.plan, interval: p.billingInterval, amount: p.amount, status: p.status, method: p.method, paidAt: p.paidAt, createdAt: p.createdAt })),
    usage: {
      projects: projectCount?.n ?? 0,
      members: memberCount?.n ?? 0,
      domains: domainCount?.n ?? 0,
      instances: running?.n ?? 0,
    },
  };
}

/** A project by slug, provided the user belongs to the team that owns it (any of their teams). */
export async function getProjectBySlug(slug: string) {
  const user = await requireUser();
  const [row] = await db
    .select({
      project: projects,
      repository: projectRepositories,
      org: organizations,
      role: memberships.role,
      // Only the login name: the password is write-only and never leaves the server.
      registryUsername: projectRegistryCredentials.username,
      registryHost: projectRegistryCredentials.registry,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(memberships, and(eq(memberships.orgId, projects.orgId), eq(memberships.userId, user.id)))
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .leftJoin(projectRegistryCredentials, eq(projects.id, projectRegistryCredentials.projectId))
    .where(eq(projects.slug, slug))
    .limit(1);
  return row ?? null;
}
