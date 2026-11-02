import { branchName, detectProject, normalizeRelativeDir, repoFullName } from 'shared';
import { badRequest, route } from '@/server/api';
import { authenticate } from '@/server/context';
import { createGithubProbe, getUserGithubToken } from '@/server/github';

export const dynamic = 'force-dynamic';

/** Runs the same framework detection the build worker uses, against the repository on GitHub. */
export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const q = new URL(req.url).searchParams;
  const repo = repoFullName.safeParse(q.get('repo'));
  if (!repo.success) throw badRequest('Invalid repo parameter');
  const branch = branchName.safeParse(q.get('branch') ?? 'main');
  if (!branch.success) throw badRequest('Invalid branch parameter');
  const rootDir = normalizeRelativeDir(q.get('rootDir'));
  if (rootDir === null) throw badRequest('Invalid root directory');

  const token = await getUserGithubToken(auth.userId);
  const detection = await detectProject(createGithubProbe(token, repo.data, branch.data), rootDir);
  return { success: true, detection };
});
