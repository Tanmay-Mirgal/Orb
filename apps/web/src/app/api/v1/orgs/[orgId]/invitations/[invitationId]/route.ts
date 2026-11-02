import { assertUuid, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';
import { revokeInvitation } from '@/server/services/invitations';

export const dynamic = 'force-dynamic';

export const DELETE = route<{ orgId: string; invitationId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req, params.orgId);
  requirePermission(role, 'members:manage');
  assertUuid(params.invitationId, 'Invitation');
  await revokeInvitation(org.id, params.invitationId);
  await audit(auth, { orgId: org.id, action: 'member.invite_revoke', targetType: 'invitation', targetId: params.invitationId });
  return { ok: true };
});
