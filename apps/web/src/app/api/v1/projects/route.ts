import { deploymentUrl } from 'core';
import { deployments, desc, eq, projectRepositories, projects } from 'database';
import { createProjectSchema } from 'shared';
import { db } from '@/lib/db';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';
import { createProject } from '@/server/services/projects';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org } = await orgContext(auth, req);
  const rows = await db
    .select({ project: projects, repository: projectRepositories, current: deployments })
    .from(projects)
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .leftJoin(deployments, eq(deployments.id, projects.currentDeploymentId))
    .where(eq(projects.orgId, org.id))
    .orderBy(desc(projects.createdAt));
  return {
    projects: rows.map((r) => ({
      ...r.project,
      url: r.project.slug ? deploymentUrl(r.project.slug) : null,
      repository: r.repository,
      currentDeployment: r.current,
    })),
  };
});

export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req);
  requirePermission(role, 'project:create');
  const input = await parseBody(req, createProjectSchema);
  const { project, repository, deployment } = await createProject({ userId: auth.userId, org, input });
  await audit(auth, { orgId: org.id, action: 'project.create', targetType: 'project', targetId: project.id, metadata: { name: project.name, type: project.type } });
  if (deployment) {
    await audit(auth, { orgId: org.id, action: 'deployment.create', targetType: 'deployment', targetId: deployment.id, metadata: { trigger: 'manual' } });
  }
  return Response.json({ success: true, project, repository, deployment }, { status: 201 });
});
