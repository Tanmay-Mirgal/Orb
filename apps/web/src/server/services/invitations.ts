import { randomBytes } from 'node:crypto';
import { emailTemplates, platformConfig, sendEmail, sha256Hex } from 'core';
import { and, count, eq, gt, invitations, isNull, memberships, notify, orgMemberIds, organizations, users, type Invitation, type Organization } from 'database';
import { getOrgPlan, NotificationType, type Role } from 'shared';
import { db } from '@/lib/db';
import { badRequest, conflict, forbidden, notFound, planLimit } from '../api';

export const INVITATION_TTL_DAYS = 7;

export type InvitationState = 'valid' | 'expired' | 'revoked' | 'accepted' | 'not_found';

function link(token: string): string {
  return `${platformConfig().dashboardUrl}/invite/${token}`;
}

async function pendingInvites(orgId: string, exceptEmail?: string): Promise<number> {
  const rows = await db
    .select({ email: invitations.email })
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
  return rows.filter((r) => r.email !== exceptEmail).length;
}

async function assertSeatAvailable(org: Organization, exceptEmail?: string) {
  const plan = getOrgPlan(org.plan);
  const [members] = await db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, org.id));
  const used = (members?.n ?? 0) + (await pendingInvites(org.id, exceptEmail));
  if (used >= plan.maxMembers) {
    throw planLimit(
      plan.maxMembers <= 1
        ? `The ${plan.name} plan is for one person. Upgrade this team to invite members.`
        : `Your ${plan.name} plan allows ${plan.maxMembers} members (pending invitations count).`,
    );
  }
}

/** Creates (or re-sends) an invitation and e-mails the link. Re-inviting the same address rotates the token. */
export async function inviteMember(options: {
  org: Organization;
  inviter: { id: string; name: string };
  email: string;
  role: Role;
}): Promise<{ invitation: Invitation; inviteUrl: string; emailSent: boolean }> {
  const { org, inviter, role } = options;
  const email = options.email.trim().toLowerCase();
  if (org.isPersonal) throw badRequest('Personal teams cannot have members. Create a team first.');

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    const [member] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, existingUser.id)))
      .limit(1);
    if (member) throw conflict('That person is already a member of this team');
  }
  await assertSeatAvailable(org, email);

  const token = randomBytes(32).toString('base64url');
  const values = {
    role,
    tokenHash: sha256Hex(token),
    invitedBy: inviter.id,
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  };
  const [pending] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.orgId, org.id), eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .limit(1);
  const [invitation] = pending
    ? await db.update(invitations).set(values).where(eq(invitations.id, pending.id)).returning()
    : await db.insert(invitations).values({ orgId: org.id, email, ...values }).returning();

  const inviteUrl = link(token);
  const content = emailTemplates.invitation({ inviterName: inviter.name, orgName: org.name, role, acceptUrl: inviteUrl, expiresInDays: INVITATION_TTL_DAYS });
  let emailSent = false;
  if (existingUser) {
    const result = await notify(db, {
      userIds: [existingUser.id],
      orgId: org.id,
      category: 'team',
      type: NotificationType.TEAM_INVITE,
      title: `${inviter.name} invited you to ${org.name}`,
      body: `Join as ${role}.`,
      href: `/invite/${token}`,
      email: () => content,
    });
    emailSent = result.emailed > 0;
  } else {
    emailSent = (await sendEmail({ to: email, ...content })).sent;
  }
  return { invitation: invitation!, inviteUrl, emailSent };
}

export async function listPendingInvitations(orgId: string) {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      invitedBy: users.name,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(invitations.createdAt);
}

export async function revokeInvitation(orgId: string, invitationId: string): Promise<void> {
  const [row] = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ id: invitations.id });
  if (!row) throw notFound('Invitation');
}

/** What the invite page shows. Never reveals anything about the token beyond the team that issued it. */
export async function previewInvitation(token: string, viewerEmail?: string | null) {
  const [row] = await db
    .select({ invitation: invitations, org: organizations, inviter: users.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(eq(invitations.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) return { state: 'not_found' as InvitationState };
  const { invitation, org } = row;
  const state: InvitationState = invitation.acceptedAt
    ? 'accepted'
    : invitation.revokedAt
      ? 'revoked'
      : invitation.expiresAt <= new Date()
        ? 'expired'
        : 'valid';
  return {
    state,
    orgId: org.id,
    orgName: org.name,
    role: invitation.role,
    invitedEmail: invitation.email,
    inviterName: row.inviter ?? 'A teammate',
    emailMatches: Boolean(viewerEmail && viewerEmail.toLowerCase() === invitation.email),
  };
}

export async function acceptInvitation(options: { token: string; user: { id: string; name: string; email: string; emailVerified: boolean } }) {
  const { token, user } = options;
  const [row] = await db
    .select({ invitation: invitations, org: organizations })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) throw notFound('Invitation');
  const { invitation, org } = row;
  if (invitation.revokedAt) throw conflict('This invitation was withdrawn');
  if (invitation.acceptedAt) throw conflict('This invitation was already used');
  if (invitation.expiresAt <= new Date()) throw conflict('This invitation has expired. Ask for a new one.');
  if (user.email.toLowerCase() !== invitation.email) {
    throw forbidden(`This invitation was sent to ${invitation.email}. Sign in with the GitHub account that uses that address.`);
  }
  if (!user.emailVerified) throw forbidden('Verify your e-mail address on GitHub first, then accept the invitation.');

  const [already] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id)))
    .limit(1);
  if (!already) {
    // The invite itself holds a seat, so only a plan that shrank meanwhile can block it.
    const plan = getOrgPlan(org.plan);
    const [members] = await db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, org.id));
    if ((members?.n ?? 0) >= plan.maxMembers) throw planLimit(`This team's ${plan.name} plan has no free seat anymore. Ask the owner to upgrade.`);
  }

  await db.transaction(async (tx) => {
    if (!already) await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: invitation.role }).onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
  });

  const admins = await orgMemberIds(db, org.id, ['owner', 'admin']);
  await notify(db, {
    userIds: admins.filter((id) => id !== user.id),
    orgId: org.id,
    category: 'team',
    type: NotificationType.TEAM_JOINED,
    title: `${user.name} joined ${org.name}`,
    body: `Role: ${invitation.role}`,
    href: '/dashboard/team',
    email: () =>
      emailTemplates.memberJoined({ memberName: user.name, orgName: org.name, role: invitation.role, teamUrl: `${platformConfig().dashboardUrl}/dashboard/team` }),
  });
  return { org, role: invitation.role as Role };
}
