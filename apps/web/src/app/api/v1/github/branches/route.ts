import { repoFullName } from 'shared';
import { badRequest, route } from '@/server/api';
import { authenticate } from '@/server/context';
import { getUserGithubToken, listBranches } from '@/server/github';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const repo = repoFullName.safeParse(new URL(req.url).searchParams.get('repo'));
  if (!repo.success) throw badRequest('Invalid repo parameter');
  return { branches: await listBranches(await getUserGithubToken(auth.userId), repo.data) };
});
