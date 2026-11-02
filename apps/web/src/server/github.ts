import { and, accounts, eq } from 'database';
import { githubFetch } from 'core';
import type { FileProbe } from 'shared';
import { db } from '@/lib/db';
import { ApiError } from './api';

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  language: string | null;
  default_branch: string;
  updated_at: string;
  pushed_at: string | null;
  owner: { login: string; avatar_url: string };
}

/** The signed-in user's GitHub OAuth token (scope `repo`). */
export async function getUserGithubToken(userId: string): Promise<string> {
  const [account] = await db
    .select({ accessToken: accounts.accessToken })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'github')))
    .limit(1);
  if (!account?.accessToken) {
    throw new ApiError(400, 'No GitHub account is linked. Sign in with GitHub first.', 'github_not_linked');
  }
  return account.accessToken;
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const res = await githubFetch(token, path);
  if (res.status === 401) throw new ApiError(401, 'GitHub token expired. Sign in with GitHub again.', 'github_token_invalid');
  if (res.status === 404) throw new ApiError(404, 'Repository not found or not accessible', 'github_not_found');
  if (!res.ok) throw new ApiError(502, `GitHub API error (${res.status})`, 'github_error');
  return (await res.json()) as T;
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await ghJson<GithubRepo[]>(
      token,
      `/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

export async function getRepo(token: string, fullName: string): Promise<GithubRepo> {
  return ghJson<GithubRepo>(token, `/repos/${fullName}`);
}

export async function listBranches(token: string, fullName: string): Promise<string[]> {
  const branches = await ghJson<Array<{ name: string }>>(token, `/repos/${fullName}/branches?per_page=100`);
  return branches.map((b) => b.name);
}

/** FileProbe over the GitHub contents API, memoised per request. */
export function createGithubProbe(token: string, fullName: string, ref: string): FileProbe {
  const cache = new Map<string, Promise<string | undefined>>();
  const read = (path: string) => {
    let pending = cache.get(path);
    if (!pending) {
      pending = (async () => {
        const res = await githubFetch(
          token,
          `/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        );
        if (!res.ok) return undefined;
        const body = (await res.json()) as { type?: string; content?: string; encoding?: string };
        if (body.type !== 'file') return undefined;
        if (body.encoding === 'base64' && body.content !== undefined) {
          return Buffer.from(body.content, 'base64').toString('utf8');
        }
        return '';
      })();
      cache.set(path, pending);
    }
    return pending;
  };
  return {
    read,
    exists: async (path) => (await read(path)) !== undefined,
  };
}
