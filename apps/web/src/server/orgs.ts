import { randomBytes } from 'node:crypto';
import { and, eq, memberships, organizations, type Organization } from 'database';
import { slugify, type Role } from 'shared';
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
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: options.name, slug, createdBy: options.ownerId, isPersonal: options.isPersonal ?? false })
      .returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: options.ownerId, role: 'owner' });
    return org!;
  });
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
