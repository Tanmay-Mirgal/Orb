import { route } from '@/server/api';
import { authenticate } from '@/server/context';
import { getUserGithubToken, listRepos } from '@/server/github';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const repos = await listRepos(await getUserGithubToken(auth.userId));
  return {
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      language: r.language,
      default_branch: r.default_branch,
      updated_at: r.pushed_at ?? r.updated_at,
    })),
  };
});
