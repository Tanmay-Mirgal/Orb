import { acceptInvitationSchema } from 'shared';
import { eq, users } from 'database';
import { db } from '@/lib/db';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate } from '@/server/context';
import { acceptInvitation } from '@/server/services/invitations';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { token } = await parseBody(req, acceptInvitationSchema);
  const [user] = await db.select({ verified: users.emailVerified }).from(users).where(eq(users.id, auth.userId)).limit(1);
  const { org, role } = await acceptInvitation({
    token,
    user: { id: auth.userId, name: auth.userName, email: auth.email, emailVerified: Boolean(user?.verified) },
  });
  await audit(auth, { orgId: org.id, action: 'member.join', targetType: 'user', targetId: auth.userId, metadata: { role } });
  return { ok: true, orgId: org.id, orgName: org.name, role };
});
