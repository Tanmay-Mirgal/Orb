import { route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, deploymentContext } from '@/server/context';
import { promoteDeployment } from '@/server/services/deployments';

export const dynamic = 'force-dynamic';

/** Promote a READY deployment to production. For an older deployment this is an instant rollback. */
export const POST = route<{ deploymentId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { deployment, project, org } = await deploymentContext(auth, params.deploymentId, 'deployment:promote');
  const isRollback = project.currentDeploymentId !== null && project.currentDeploymentId !== deployment.id;
  const result = await promoteDeployment(project, deployment);
  await audit(auth, {
    orgId: org.id,
    action: isRollback ? 'deployment.rollback' : 'deployment.promote',
    targetType: 'deployment',
    targetId: deployment.id,
    metadata: { previous: project.currentDeploymentId },
  });
  return { ok: true, ...result };
});
