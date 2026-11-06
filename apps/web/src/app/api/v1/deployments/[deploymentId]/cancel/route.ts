import { actorOf } from '@/server/actor';
import { route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, deploymentContext } from '@/server/context';
import { cancelDeployment } from '@/server/services/deployments';

export const dynamic = 'force-dynamic';

export const POST = route<{ deploymentId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { deployment, org } = await deploymentContext(auth, params.deploymentId, 'deployment:create');
  const updated = await cancelDeployment(deployment, actorOf(auth));
  await audit(auth, { orgId: org.id, action: 'deployment.cancel', targetType: 'deployment', targetId: deployment.id });
  return { deployment: updated };
});
