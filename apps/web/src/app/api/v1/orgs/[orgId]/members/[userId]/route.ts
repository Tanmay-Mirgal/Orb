import { emailTemplates, platformConfig } from 'core';
import { and, count, eq, memberships, notify } from 'database';
import { canAssignRole, NotificationType, roleRank, updateMemberSchema, type Role } from 'shared';
import { db } from '@/lib/db';
import { conflict, forbidden, notFound, parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';

export const dynamic = 'force-dynamic';

async function loadTarget(orgId: string, userId: string) {
  const [target] = await db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  if (!target) throw notFound('Member');
  return target;
}

async function assertNotLastOwner(orgId: string, target: { role: string }) {
  if (target.role !== 'owner') return;
  const [owners] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
  if ((owners?.n ?? 0) <= 1) throw conflict('A team must keep at least one owner');
}

export const PATCH = route<{ orgId: string; userId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role: actorRole } = await orgContext(auth, req, params.orgId);
  requirePermission(actorRole, 'members:manage');
  const { role } = await parseBody(req, updateMemberSchema);
  const target = await loadTarget(org.id, params.userId);
  if (!canAssignRole(actorRole, role as Role) || roleRank(target.role) > roleRank(actorRole)) {
    throw forbidden('You cannot change this member\'s role');
  }
  if (role !== 'owner') await assertNotLastOwner(org.id, target);
  await db.update(memberships).set({ role }).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, params.userId)));
  await audit(auth, { orgId: org.id, action: 'member.role', targetType: 'user', targetId: params.userId, metadata: { role } });
  if (params.userId !== auth.userId) {
    await notify(db, {
      userIds: [params.userId],
      orgId: org.id,
      category: 'team',
      type: NotificationType.TEAM_ROLE_CHANGED,
      title: `Your role in ${org.name} is now ${role}`,
      body: `Changed by ${auth.userName}.`,
      href: '/dashboard/team',
      email: () => emailTemplates.roleChanged({ orgName: org.name, role, byName: auth.userName, dashboardUrl: `${platformConfig().dashboardUrl}/dashboard` }),
    });
  }
  return { ok: true };
});

export const DELETE = route<{ orgId: string; userId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role: actorRole } = await orgContext(auth, req, params.orgId);
  const leavingSelf = params.userId === auth.userId;
  if (!leavingSelf) requirePermission(actorRole, 'members:manage');
  const target = await loadTarget(org.id, params.userId);
  if (!leavingSelf && roleRank(target.role) >= roleRank(actorRole) && actorRole !== 'owner') {
    throw forbidden('You cannot remove this member');
  }
  await assertNotLastOwner(org.id, target);
  await db.delete(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, params.userId)));
  await audit(auth, { orgId: org.id, action: leavingSelf ? 'member.leave' : 'member.remove', targetType: 'user', targetId: params.userId });
  if (!leavingSelf) {
    await notify(db, {
      userIds: [params.userId],
      category: 'team',
      type: NotificationType.TEAM_REMOVED,
      title: `You were removed from ${org.name}`,
      body: `Removed by ${auth.userName}.`,
      email: () => emailTemplates.removedFromTeam({ orgName: org.name, byName: auth.userName }),
    });
  }
  return { ok: true };
});
