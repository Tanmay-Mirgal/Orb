import { updateDomainSchema } from 'shared';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { removeDomain, updateDomainRedirect } from '@/server/services/domains';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ projectId: string; domain: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'domain:manage');
  const { redirectTo } = await parseBody(req, updateDomainSchema);
  const domain = await updateDomainRedirect(params.projectId, decodeURIComponent(params.domain), redirectTo);
  await audit(auth, { orgId: ctx.org.id, action: 'domain.update', targetType: 'domain', targetId: domain.domain, metadata: { redirectTo } });
  return { domain };
});

export const DELETE = route<{ projectId: string; domain: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'domain:manage');
  await removeDomain(params.projectId, decodeURIComponent(params.domain));
  await audit(auth, { orgId: ctx.org.id, action: 'domain.remove', targetType: 'domain', targetId: params.domain });
  return { ok: true };
});
