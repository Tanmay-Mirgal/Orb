import { canAssignRole, inviteMemberSchema, type Role } from 'shared';
import { forbidden, parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';
import { inviteMember, listPendingInvitations } from '@/server/services/invitations';

export const dynamic = 'force-dynamic';

export const GET = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req, params.orgId);
  requirePermission(role, 'members:manage');
  return { invitations: await listPendingInvitations(org.id) };
});

/** Invites a person by e-mail (they do not need an Orb account yet). The link is also returned for manual sharing. */
export const POST = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role: actorRole } = await orgContext(auth, req, params.orgId);
  requirePermission(actorRole, 'members:manage');
  const input = await parseBody(req, inviteMemberSchema);
  const role = input.role as Role;
  if (!canAssignRole(actorRole, role)) throw forbidden('You cannot grant a role equal to or above your own');

  const { invitation, inviteUrl, emailSent } = await inviteMember({ org, inviter: { id: auth.userId, name: auth.userName }, email: input.email, role });
  await audit(auth, { orgId: org.id, action: 'member.invite', targetType: 'invitation', targetId: invitation.id, metadata: { email: input.email, role } });
  return Response.json({ ok: true, emailSent, inviteUrl, invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } }, { status: 201 });
});
