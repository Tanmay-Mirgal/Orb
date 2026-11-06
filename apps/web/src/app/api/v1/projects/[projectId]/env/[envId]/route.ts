import { actorOf } from '@/server/actor';
import { assertUuid, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { deleteEnvVar } from '@/server/services/env';

export const dynamic = 'force-dynamic';

export const DELETE = route<{ projectId: string; envId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'env:write');
  assertUuid(params.envId, 'Environment variable');
  await deleteEnvVar(params.projectId, params.envId, actorOf(auth));
  await audit(auth, { orgId: ctx.org.id, action: 'env.delete', targetType: 'project', targetId: params.projectId, metadata: { id: params.envId } });
  return { ok: true };
});
