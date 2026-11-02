import { emailTemplates, platformConfig } from 'core';
import { and, count, eq, memberships, notify, users } from 'database';
import { addMemberSchema, canAssignRole, getOrgPlan, NotificationType, type Role } from 'shared';
import { db } from '@/lib/db';
import { badRequest, conflict, forbidden, notFound, parseBody, planLimit, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';

export const dynamic = 'force-dynamic';

export const GET = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org } = await orgContext(auth, req, params.orgId);
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, image: users.image, role: memberships.role, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, org.id));
  return { members: rows };
});

/** Adds an existing Orb user straight to the team (API use). The dashboard sends invitations instead, which the invitee accepts. */
export const POST = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role: actorRole } = await orgContext(auth, req, params.orgId);
  requirePermission(actorRole, 'members:manage');
  const input = await parseBody(req, addMemberSchema);
  const role = input.role as Role;
  if (!canAssignRole(actorRole, role)) throw forbidden('You cannot grant a role equal to or above your own');
  if (org.isPersonal) throw badRequest('Personal teams cannot have additional members. Create a team instead.');

  const plan = getOrgPlan(org.plan);
  const [members] = await db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, org.id));
  if ((members?.n ?? 0) >= plan.maxMembers) throw planLimit(`Your ${plan.name} plan allows ${plan.maxMembers} member(s)`);

  const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
  if (!user) throw notFound('User (they need to sign in to Orb once first)');
  const existing = await db.select().from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id)));
  if (existing.length > 0) throw conflict('Already a member');

  await db.insert(memberships).values({ orgId: org.id, userId: user.id, role });
  await audit(auth, { orgId: org.id, action: 'member.add', targetType: 'user', targetId: user.id, metadata: { role } });
  await notify(db, {
    userIds: [user.id],
    orgId: org.id,
    category: 'team',
    type: NotificationType.TEAM_ROLE_CHANGED,
    title: `${auth.userName} added you to ${org.name}`,
    body: `Role: ${role}`,
    href: '/dashboard/team',
    email: () => emailTemplates.roleChanged({ orgName: org.name, role, byName: auth.userName, dashboardUrl: `${platformConfig().dashboardUrl}/dashboard` }),
  });
  return Response.json({ ok: true }, { status: 201 });
});
