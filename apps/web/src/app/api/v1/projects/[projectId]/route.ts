import { deploymentUrl } from 'core';
import { deployments, eq } from 'database';
import { updateProjectSchema } from 'shared';
import { db } from '@/lib/db';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { deleteProject, updateProject } from '@/server/services/projects';

export const dynamic = 'force-dynamic';

export const GET = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { project, repository, role } = await projectContext(auth, params.projectId, 'project:read');
  const current = project.currentDeploymentId
    ? (await db.select().from(deployments).where(eq(deployments.id, project.currentDeploymentId)).limit(1))[0] ?? null
    : null;
  return { project: { ...project, url: project.slug ? deploymentUrl(project.slug) : null }, repository, currentDeployment: current, role };
});

export const PATCH = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'project:update');
  const input = await parseBody(req, updateProjectSchema);
  const project = await updateProject({ org: ctx.org, project: ctx.project, input });
  await audit(auth, { orgId: ctx.org.id, action: 'project.update', targetType: 'project', targetId: project.id, metadata: { fields: Object.keys(input) } });
  return { project };
});

export const DELETE = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'project:delete');
  await deleteProject(ctx.project);
  await audit(auth, { orgId: ctx.org.id, action: 'project.delete', targetType: 'project', targetId: ctx.project.id, metadata: { name: ctx.project.name } });
  return { ok: true };
});
