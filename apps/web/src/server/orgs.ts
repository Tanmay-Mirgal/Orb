import { randomBytes } from 'node:crypto';
import { emailTemplates, platformConfig } from 'core';
import { and, applyPlanGrants, eq, memberships, notify, organizations, type Organization } from 'database';
import { getOrgPlan, NotificationType, slugify, type Role } from 'shared';
import { db } from '@/lib/db';

/** Organisation slug: unique, DNS-friendly, never reveals the user's email. */
async function uniqueOrgSlug(base: string): Promise<string> {
  const root = slugify(base, 30);
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? root : `${root}-${randomBytes(2).toString('hex')}`;
    const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (existing.length === 0) return slug;
  }
  return `${root}-${randomBytes(4).toString('hex')}`;
}

export async function createOrganization(options: {
  name: string;
  ownerId: string;
  isPersonal?: boolean;
}): Promise<Organization> {
  const slug = await uniqueOrgSlug(options.name);
  const created = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: options.name, slug, createdBy: options.ownerId, isPersonal: options.isPersonal ?? false })
      .returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: options.ownerId, role: 'owner' });
    return org!;
  });
  // A complimentary plan registered for the owner's e-mail covers the new team straight away.
  const covered = (await syncPlanGrants(options.ownerId)).some((g) => g.orgId === created.id);
  if (!covered) return created;
  const [fresh] = await db.select().from(organizations).where(eq(organizations.id, created.id)).limit(1);
  return fresh ?? created;
}

/** Applies the user's complimentary plan (if any) to the teams they own and tells them about newly covered teams. */
export async function syncPlanGrants(userId: string) {
  try {
    const applied = await applyPlanGrants(db, userId);
    for (const grant of applied) {
      const plan = getOrgPlan(grant.plan);
      await notify(db, {
        userIds: [userId],
        orgId: grant.orgId,
        category: 'billing',
        type: NotificationType.BILLING_GRANTED,
        title: `${plan.name} plan activated for ${grant.orgName}`,
        body: `Complimentary until ${grant.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
        href: '/dashboard/billing',
        email: () => emailTemplates.planGranted({ orgName: grant.orgName, planName: plan.name, expiresAt: grant.expiresAt, billingUrl: `${platformConfig().dashboardUrl}/dashboard/billing` }),
      });
    }
    return applied;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'plan grant sync failed', userId, err: String(err) }));
    return [];
  }
}

/**
 * Every team starts with 5 free projects, so the number of teams one person may own is capped unless they pay:
 * otherwise a single account could multiply the free tier at our cost.
 */
export const MAX_OWNED_TEAMS_FREE = 3;
export const MAX_OWNED_TEAMS_PAID = 25;

export async function ownedTeamLimit(userId: string): Promise<{ owned: number; limit: number }> {
  const rows = await db
    .select({ plan: organizations.plan })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));
  const paying = rows.some((r) => r.plan !== 'free');
  return { owned: rows.length, limit: paying ? MAX_OWNED_TEAMS_PAID : MAX_OWNED_TEAMS_FREE };
}

/** Called right after a user signs up (and lazily on first request for pre-existing users). */
export async function ensurePersonalOrganization(user: { id: string; name: string }): Promise<Organization> {
  const existing = await db
    .select({ org: organizations })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.orgId, organizations.id))
    .where(and(eq(memberships.userId, user.id), eq(organizations.isPersonal, true)))
    .limit(1);
  if (existing[0]) return existing[0].org;
  return createOrganization({ name: `${user.name || 'My'}'s Team`, ownerId: user.id, isPersonal: true });
}

export interface OrgMembership {
  org: Organization;
  role: Role;
}

export async function listMemberships(userId: string): Promise<OrgMembership[]> {
  const rows = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId));
  return rows
    .map((r) => ({ org: r.org, role: r.role as Role }))
    .sort((a, b) => Number(b.org.isPersonal) - Number(a.org.isPersonal) || a.org.name.localeCompare(b.org.name));
}

export const ORG_COOKIE = 'orb_org';

/** Picks the active organisation: explicit choice (if the user belongs to it), else personal, else first. */
export async function resolveActiveOrg(
  user: { id: string; name: string },
  preferredOrgId?: string | null,
): Promise<OrgMembership & { all: OrgMembership[] }> {
  let all = await listMemberships(user.id);
  if (all.length === 0) {
    const org = await ensurePersonalOrganization(user);
    all = [{ org, role: 'owner' }];
  }
  const chosen = (preferredOrgId && all.find((m) => m.org.id === preferredOrgId)) || all[0]!;
  return { ...chosen, all };
}
