import { route } from '@/server/api';
import { authenticate, deploymentContext } from '@/server/context';
import { getLogStore, getStorage } from '@/server/infra';
import { storageKeys } from 'storage';
import { TERMINAL_DEPLOYMENT_STATUSES, type DeploymentStatus } from 'shared';

export const dynamic = 'force-dynamic';

async function readArchivedLog(deploymentId: string): Promise<string[]> {
  const object = await getStorage().get(storageKeys.buildLog(deploymentId));
  if (!object) return [];
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean);
}

/**
 * Build log. Cursor based: `?from=N` returns lines N.. and `next` for the following poll.
 * Falls back to the copy archived in object storage once Redis has expired the live log.
 */
export const GET = route<{ deploymentId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { deployment } = await deploymentContext(auth, params.deploymentId);
  const from = Math.max(0, Number(new URL(req.url).searchParams.get('from') ?? 0) || 0);

  let { lines, next } = await getLogStore().readBuild(deployment.id, from);
  if (lines.length === 0 && from === 0) {
    const archived = await readArchivedLog(deployment.id).catch(() => []);
    if (archived.length > 0) {
      lines = archived;
      next = archived.length;
    }
  }
  const done = TERMINAL_DEPLOYMENT_STATUSES.includes(deployment.status as DeploymentStatus);
  return { lines, next, status: deployment.status, done };
});
