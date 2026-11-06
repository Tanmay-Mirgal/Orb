import { actorOf } from '@/server/actor';
import { createDomainSchema } from 'shared';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { addDomain, listProjectDomains } from '@/server/services/domains';

export const dynamic = 'force-dynamic';

export const GET = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  await projectContext(auth, params.projectId, 'project:read');
  return { domains: await listProjectDomains(params.projectId) };
});

export const POST = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'domain:manage');
  const input = await parseBody(req, createDomainSchema);
  const domain = await addDomain({ projectId: params.projectId, orgPlan: ctx.org.plan, rawDomain: input.domain, redirectTo: input.redirectTo, actor: actorOf(auth) });
  await audit(auth, { orgId: ctx.org.id, action: 'domain.add', targetType: 'domain', targetId: domain.domain, metadata: { projectId: params.projectId } });
  return Response.json({ success: true, domain }, { status: 201 });
});
