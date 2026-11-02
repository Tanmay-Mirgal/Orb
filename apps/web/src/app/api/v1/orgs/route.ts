import { createOrgSchema } from 'shared';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate } from '@/server/context';
import { createOrganization, listMemberships } from '@/server/orgs';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const memberships = await listMemberships(auth.userId);
  return { organizations: memberships.map((m) => ({ ...m.org, role: m.role })) };
});

export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { name } = await parseBody(req, createOrgSchema);
  const org = await createOrganization({ name, ownerId: auth.userId });
  await audit(auth, { orgId: org.id, action: 'org.create', targetType: 'org', targetId: org.id });
  return Response.json({ organization: { ...org, role: 'owner' } }, { status: 201 });
});
