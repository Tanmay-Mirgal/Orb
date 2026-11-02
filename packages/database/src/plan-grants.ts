import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { PLAN_ORDER, planRank } from 'shared';
import type { Database } from './client';
import { memberships, organizations, planGrants, users } from './schema';

export interface AppliedGrant {
  orgId: string;
  orgName: string;
  plan: string;
  expiresAt: Date;
}

/**
 * Applies the complimentary plan registered for a user's e-mail (table `plan_grants`) to every team they own
 * that is on a lower plan. Only ever used for verified e-mail addresses, so a grant cannot be claimed by signing
 * up with someone else's address. Idempotent: running it on every sign-in is cheap and keeps new teams covered.
 */
export async function applyPlanGrants(db: Database, userId: string): Promise<AppliedGrant[]> {
  const [user] = await db.select({ email: users.email, verified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.verified) return [];
  const [grant] = await db
    .select()
    .from(planGrants)
    .where(and(eq(planGrants.email, user.email.toLowerCase()), gt(planGrants.expiresAt, new Date())))
    .limit(1);
  if (!grant) return [];

  const lower = PLAN_ORDER.slice(0, Math.max(0, planRank(grant.plan)));
  const owned = db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));

  const rows = await db
    .update(organizations)
    .set({ plan: grant.plan, planSource: 'grant', planExpiresAt: grant.expiresAt, updatedAt: new Date() })
    .where(and(inArray(organizations.id, owned), inArray(organizations.plan, [...lower])))
    .returning({ id: organizations.id, name: organizations.name });
  // Same plan already: just keep the grant's expiry if it is later than what the team has.
  await db
    .update(organizations)
    .set({ planExpiresAt: grant.expiresAt, updatedAt: new Date() })
    .where(
      and(
        inArray(organizations.id, owned),
        eq(organizations.plan, grant.plan),
        eq(organizations.planSource, 'grant'),
        sql`${organizations.planExpiresAt} < ${grant.expiresAt}`,
      ),
    );
  return rows.map((r) => ({ orgId: r.id, orgName: r.name, plan: grant.plan, expiresAt: grant.expiresAt }));
}
