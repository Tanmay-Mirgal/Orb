import { badRequest, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, deploymentContext } from '@/server/context';
import { createDeployment } from '@/server/services/deployments';

export const dynamic = 'force-dynamic';

/** Rebuilds the same commit with the same settings (e.g. after changing environment variables). */
export const POST = route<{ deploymentId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { deployment, project, repository, org } = await deploymentContext(auth, params.deploymentId, 'deployment:create');
  if (!repository) throw badRequest('Project has no connected repository');
  const created = await createDeployment({
    project,
    repository,
    orgPlan: org.plan,
    environment: deployment.environment === 'preview' ? 'preview' : 'production',
    trigger: 'redeploy',
    branch: deployment.branch ?? repository.branch,
    commitSha: deployment.commitHash,
    commitMessage: deployment.commitMessage,
    commitAuthor: deployment.commitAuthor,
    config: deployment.config ?? undefined,
    createdBy: auth.userId,
  });
  await audit(auth, { orgId: org.id, action: 'deployment.redeploy', targetType: 'deployment', targetId: created.id, metadata: { from: deployment.id } });
  return Response.json({ success: true, deployment: created }, { status: 201 });
});
