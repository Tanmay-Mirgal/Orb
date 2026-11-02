import { deployments, desc, eq, projects } from 'database';
import { db } from '@/lib/db';
import { route } from '@/server/api';
import { authenticate, orgContext } from '@/server/context';

export const dynamic = 'force-dynamic';

/** Latest deployments across every project of the active team (dashboard activity feed). */
export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org } = await orgContext(auth, req);
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 10) || 10, 50);
  const rows = await db
    .select({
      id: deployments.id,
      status: deployments.status,
      environment: deployments.environment,
      branch: deployments.branch,
      commitMessage: deployments.commitMessage,
      commitHash: deployments.commitHash,
      createdAt: deployments.createdAt,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(eq(projects.orgId, org.id))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
  return { activity: rows };
});
