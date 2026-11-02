import { deploymentUrl } from 'core';
import { route } from '@/server/api';
import { authenticate, deploymentContext } from '@/server/context';
import { runningInstances } from '@/server/services/deployments';

export const dynamic = 'force-dynamic';

export const GET = route<{ deploymentId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { deployment, project } = await deploymentContext(auth, params.deploymentId);
  const insts = await runningInstances(deployment.id);
  return {
    deployment: {
      ...deployment,
      url: deployment.subdomain ? deploymentUrl(deployment.subdomain) : null,
      isCurrent: project.currentDeploymentId === deployment.id,
    },
    instances: insts.map((i) => ({ id: i.id, nodeId: i.nodeId, status: i.status, createdAt: i.createdAt })),
  };
});
