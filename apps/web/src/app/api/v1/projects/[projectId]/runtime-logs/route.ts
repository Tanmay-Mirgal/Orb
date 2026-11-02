import { instances, desc, eq } from 'database';
import { db } from '@/lib/db';
import { route } from '@/server/api';
import { authenticate, projectContext } from '@/server/context';
import { getLogStore } from '@/server/infra';

export const dynamic = 'force-dynamic';

/**
 * Live runtime logs of the currently serving deployment (or `?deploymentId=`).
 * Cursor based: pass the returned `last` as `after` to receive only newer lines.
 */
export const GET = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { project } = await projectContext(auth, params.projectId, 'project:read');
  const url = new URL(req.url);
  let deploymentId = url.searchParams.get('deploymentId') ?? project.currentDeploymentId;
  if (!deploymentId) {
    const [latest] = await db.select({ id: instances.deploymentId }).from(instances).where(eq(instances.projectId, project.id)).orderBy(desc(instances.createdAt)).limit(1);
    deploymentId = latest?.id ?? null;
  }
  if (!deploymentId) return { deploymentId: null, entries: [], last: null };
  const after = url.searchParams.get('after') ?? undefined;
  const { entries, last } = await getLogStore().readRuntime(deploymentId, after && /^\d+-\d+$/.test(after) ? after : undefined);
  return { deploymentId, entries, last: last ?? null };
});
