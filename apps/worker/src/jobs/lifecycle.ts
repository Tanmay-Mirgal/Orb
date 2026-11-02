import { emailTemplates, platformConfig, publishRouteInvalidation } from 'core';
import {
  and,
  deployments,
  eq,
  inArray,
  instances,
  isNotNull,
  isNull,
  lt,
  ne,
  notify,
  orgMemberIds,
  organizations,
  projects,
} from 'database';
import { getOrgPlan, NotificationType, ORG_PLANS, REDIS_KEYS } from 'shared';
import type { WorkerContext } from '../context';
import { ACTIVE_INSTANCE_STATUSES } from '../orchestrator/nodes';
import { stopInstances } from '../orchestrator/release';

const DAY = 86_400_000;
const REMINDER_DAYS = [7, 3, 1] as const;

const billingUrl = () => `${platformConfig().dashboardUrl}/dashboard/billing`;
const dateLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------------------------------------------------------------------------
// Paid / granted plans: remind before they end, fall back to Hobby when they do.
// ---------------------------------------------------------------------------
export async function runPlanExpiry(ctx: WorkerContext) {
  const now = new Date();
  let expired = 0;
  let reminded = 0;

  const ending = await ctx.db
    .select({ id: organizations.id, name: organizations.name, plan: organizations.plan, expiresAt: organizations.planExpiresAt })
    .from(organizations)
    .where(and(ne(organizations.plan, 'free'), isNotNull(organizations.planExpiresAt), lt(organizations.planExpiresAt, new Date(now.getTime() + REMINDER_DAYS[0] * DAY))))
    .limit(500);

  for (const org of ending) {
    const expiresAt = org.expiresAt!;
    const plan = getOrgPlan(org.plan);

    if (expiresAt <= now) {
      // Compare-and-set on the plan so a payment that lands during this run is never overwritten.
      const [downgraded] = await ctx.db
        .update(organizations)
        .set({ plan: 'free', planSource: 'free', planExpiresAt: null, updatedAt: now })
        .where(and(eq(organizations.id, org.id), eq(organizations.plan, org.plan), lt(organizations.planExpiresAt, now)))
        .returning({ id: organizations.id });
      if (!downgraded) continue;
      expired++;
      // Resources beyond Hobby limits keep running until their next deploy; new deploys use Hobby sizes.
      await ctx.db.update(projects).set({ instancePlan: 'free', instanceCount: 1, previewDeployments: false, updatedAt: now }).where(eq(projects.orgId, org.id));
      await notify(ctx.db, {
        userIds: await orgMemberIds(ctx.db, org.id, ['owner']),
        orgId: org.id,
        category: 'billing',
        type: NotificationType.BILLING_EXPIRED,
        title: `${org.name} is back on the Hobby plan`,
        body: `The ${plan.name} plan ended. Nothing was deleted.`,
        href: '/dashboard/billing',
        email: () => emailTemplates.planExpired({ orgName: org.name, planName: plan.name, billingUrl: billingUrl() }),
      });
      continue;
    }

    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
    if (!(REMINDER_DAYS as readonly number[]).includes(daysLeft)) continue;
    const first = await ctx.redis.set(`orb:planremind:${org.id}:${expiresAt.getTime()}:${daysLeft}`, '1', 'EX', 10 * 86_400, 'NX');
    if (!first) continue;
    reminded++;
    await notify(ctx.db, {
      userIds: await orgMemberIds(ctx.db, org.id, ['owner']),
      orgId: org.id,
      category: 'billing',
      type: NotificationType.BILLING_EXPIRING,
      title: `${plan.name} plan ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      body: `${org.name} returns to Hobby on ${dateLabel(expiresAt)}.`,
      href: '/dashboard/billing',
      email: () => emailTemplates.planExpiring({ orgName: org.name, planName: plan.name, expiresAt, daysLeft, billingUrl: billingUrl() }),
    });
  }
  return { expired, reminded };
}

// ---------------------------------------------------------------------------
// Scale to zero: free-plan web services without traffic are stopped; the edge wakes them on the next request.
// Always-on RAM is what makes a free tier expensive, and most free projects are idle most of the time.
// ---------------------------------------------------------------------------
export async function runIdleSleep(ctx: WorkerContext) {
  let slept = 0;
  for (const plan of Object.values(ORG_PLANS)) {
    if (plan.idleSleepMinutes === null) continue;
    // IDLE_SLEEP_MINUTES overrides the plan default; 0 turns the feature off.
    const override = process.env.IDLE_SLEEP_MINUTES;
    const minutes = override !== undefined && override !== '' ? Number(override) : plan.idleSleepMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const idleMs = minutes * 60_000;

    const candidates = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .where(and(eq(organizations.plan, plan.id), eq(projects.type, 'web_service'), isNull(projects.sleepingAt), isNotNull(projects.currentDeploymentId)))
      .limit(2000);
    if (candidates.length === 0) continue;

    const running = await ctx.db
      .select({ id: instances.id, projectId: instances.projectId, nodeId: instances.nodeId, containerId: instances.containerId, createdAt: instances.createdAt })
      .from(instances)
      .where(and(inArray(instances.projectId, candidates.map((c) => c.id)), inArray(instances.status, ACTIVE_INSTANCE_STATUSES)));
    const byProject = new Map<string, typeof running>();
    for (const inst of running) byProject.set(inst.projectId, [...(byProject.get(inst.projectId) ?? []), inst]);

    const ids = [...byProject.keys()];
    const seen = ids.length ? await ctx.redis.mget(ids.map((id) => REDIS_KEYS.lastSeen(id))) : [];
    const lastSeen = new Map(ids.map((id, i) => [id, Number(seen[i] ?? 0)]));

    const now = Date.now();
    for (const [projectId, rows] of byProject) {
      // A fresh deployment (or a wake-up) restarts the clock: use whichever is newer, last request or last start.
      const newestStart = Math.max(...rows.map((r) => r.createdAt.getTime()));
      if (now - Math.max(lastSeen.get(projectId) ?? 0, newestStart) < idleMs) continue;
      const [claimed] = await ctx.db
        .update(projects)
        .set({ sleepingAt: new Date() })
        .where(and(eq(projects.id, projectId), isNull(projects.sleepingAt)))
        .returning({ id: projects.id });
      if (!claimed) continue;
      await stopInstances(ctx, rows);
      await publishRouteInvalidation(ctx.redis, { projectId });
      slept++;
      ctx.logger.info({ projectId, idleMinutes: minutes }, 'service put to sleep');
    }
  }
  return { slept };
}

// ---------------------------------------------------------------------------
// Alerts raised by other maintenance jobs.
// ---------------------------------------------------------------------------
export async function notifyServiceDown(ctx: WorkerContext, deploymentId: string): Promise<void> {
  try {
    const [row] = await ctx.db
      .select({ project: projects, orgId: organizations.id })
      .from(deployments)
      .innerJoin(projects, eq(projects.id, deployments.projectId))
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!row) return;
    // One alert per service every 6 hours, however many times it flaps.
    const first = await ctx.redis.set(`orb:svcdown:${row.project.id}`, '1', 'EX', 6 * 3600, 'NX');
    if (!first) return;
    const admins = await orgMemberIds(ctx.db, row.orgId, ['owner', 'admin']);
    await notify(ctx.db, {
      userIds: [row.project.userId, ...admins],
      orgId: row.orgId,
      category: 'deployments',
      type: NotificationType.SERVICE_DOWN,
      title: `${row.project.name} lost an instance`,
      body: 'Orb is starting a replacement automatically.',
      href: `/dashboard/projects/${row.project.slug ?? ''}`,
      email: () =>
        emailTemplates.serviceDown({ projectName: row.project.name, dashboardUrl: `${platformConfig().dashboardUrl}/dashboard/projects/${row.project.slug ?? ''}` }),
    });
  } catch (err) {
    ctx.logger.warn({ deploymentId, err: String(err) }, 'service-down notification failed');
  }
}

export async function notifyDomainChange(
  ctx: WorkerContext,
  domain: { domain: string; projectId: string; status: string; lastError: string | null },
  previousStatus: string,
): Promise<void> {
  try {
    const nowActive = domain.status === 'active';
    if (nowActive === (previousStatus === 'active')) return;
    // A brand-new domain that is still waiting for DNS is not news; only a working domain breaking is.
    if (!nowActive && previousStatus !== 'active') return;
    const [row] = await ctx.db
      .select({ project: projects, orgId: organizations.id })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .where(eq(projects.id, domain.projectId))
      .limit(1);
    if (!row) return;
    const admins = await orgMemberIds(ctx.db, row.orgId, ['owner', 'admin']);
    const dashboardUrl = `${platformConfig().dashboardUrl}/dashboard/projects/${row.project.slug ?? ''}`;
    await notify(ctx.db, {
      userIds: [row.project.userId, ...admins],
      orgId: row.orgId,
      category: 'domains',
      type: nowActive ? NotificationType.DOMAIN_ACTIVE : NotificationType.DOMAIN_ERROR,
      title: nowActive ? `${domain.domain} is live` : `${domain.domain} needs attention`,
      body: nowActive ? `Serving ${row.project.name} over HTTPS.` : (domain.lastError ?? 'DNS no longer points at Orb.'),
      href: `/dashboard/projects/${row.project.slug ?? ''}`,
      email: () =>
        nowActive
          ? emailTemplates.domainActive({ domain: domain.domain, projectName: row.project.name, dashboardUrl })
          : emailTemplates.domainError({ domain: domain.domain, detail: domain.lastError, dashboardUrl }),
    });
  } catch (err) {
    ctx.logger.warn({ domain: domain.domain, err: String(err) }, 'domain notification failed');
  }
}
