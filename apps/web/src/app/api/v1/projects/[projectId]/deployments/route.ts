import { createDeploymentSchema } from 'shared';
import { badRequest, parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { createDeployment, listDeployments } from '@/server/services/deployments';

export const dynamic = 'force-dynamic';

export const GET = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  await projectContext(auth, params.projectId, 'project:read');
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 30) || 30;
  return { deployments: await listDeployments(params.projectId, limit) };
});

/** Manual deploy of the production branch (or any branch/commit as a preview). */
export const POST = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'deployment:create');
  if (!ctx.repository) throw badRequest('Project has no connected repository');
  const input = await parseBody(req, createDeploymentSchema);
  const branch = input.branch ?? ctx.repository.branch;
  const isPreview = input.preview ?? branch !== ctx.repository.branch;
  const deployment = await createDeployment({
    project: ctx.project,
    repository: ctx.repository,
    orgPlan: ctx.org.plan,
    environment: isPreview ? 'preview' : 'production',
    trigger: auth.via === 'token' ? 'api' : 'manual',
    branch,
    commitSha: input.commitSha ?? null,
    createdBy: auth.userId,
  });
  await audit(auth, { orgId: ctx.org.id, action: 'deployment.create', targetType: 'deployment', targetId: deployment.id, metadata: { branch, preview: isPreview } });
  return Response.json({ success: true, deployment }, { status: 201 });
});
