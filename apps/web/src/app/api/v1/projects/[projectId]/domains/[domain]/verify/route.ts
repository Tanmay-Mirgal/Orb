import { actorOf } from '@/server/actor';
import { route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { verifyDomain } from '@/server/services/domains';

export const dynamic = 'force-dynamic';

/** Re-checks DNS now (the worker also re-checks pending domains every few minutes). */
export const POST = route<{ projectId: string; domain: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'domain:manage');
  const result = await verifyDomain(params.projectId, decodeURIComponent(params.domain), actorOf(auth));
  await audit(auth, { orgId: ctx.org.id, action: 'domain.verify', targetType: 'domain', targetId: result.domain.domain, metadata: { status: result.domain.status } });
  return result;
});
