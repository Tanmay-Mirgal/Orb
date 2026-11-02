import * as fs from 'node:fs';
import { branchName, repoFullName } from 'shared';
import { runCommand } from './process';

export interface CloneResult {
  sha: string;
  author: string;
  message: string;
}

export interface CloneOptions {
  repo: string;
  /** Branch name; combined with `sha` to build an exact commit. */
  branch: string;
  sha?: string | null;
  dest: string;
  /** GitHub App installation token or user OAuth token. Omit for public repositories. */
  token?: string;
  onLine: (line: string) => void;
  signal?: AbortSignal;
}

/**
 * Shallow, token-safe clone:
 *  - the credential is passed through git's environment config (never in argv, never written to .git/config);
 *  - repo and ref are re-validated here because they end up in a git command line;
 *  - a full 40-char SHA is fetched directly so builds are reproducible even if the branch moved on.
 */
export async function cloneRepository(options: CloneOptions): Promise<CloneResult> {
  if (!repoFullName.safeParse(options.repo).success) throw new Error('Invalid repository name');
  if (!branchName.safeParse(options.branch).success) throw new Error('Invalid branch name');
  const sha = options.sha && /^[a-f0-9]{7,40}$/i.test(options.sha) ? options.sha : undefined;

  fs.mkdirSync(options.dest, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? process.env.USERPROFILE,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GCM_INTERACTIVE: 'never',
  };
  if (options.token) {
    const basic = Buffer.from(`x-access-token:${options.token}`).toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }

  const git = async (args: string[], timeoutMs = 5 * 60_000) => {
    const lines: string[] = [];
    const code = await runCommand('git', args, {
      cwd: options.dest,
      env,
      timeoutMs,
      signal: options.signal,
      onLine: (l) => lines.push(l),
    });
    if (code !== 0) throw new Error(`git ${args[0]} failed (exit ${code}): ${lines.slice(-3).join(' | ')}`);
    return lines;
  };

  await git(['init', '-q']);
  await git(['remote', 'add', 'origin', `https://github.com/${options.repo}.git`]);
  if (sha && sha.length === 40) {
    await git(['fetch', '-q', '--depth', '1', 'origin', sha]);
    await git(['checkout', '-q', '--detach', 'FETCH_HEAD']);
  } else {
    await git(['fetch', '-q', '--depth', sha ? '200' : '1', 'origin', options.branch]);
    await git(['checkout', '-q', '--detach', sha ?? 'FETCH_HEAD']);
  }

  const out = await git(['log', '-1', '--format=%H%x1f%an%x1f%s']);
  const [fullSha = '', author = '', message = ''] = (out[0] ?? '').split('\x1f');
  fs.rmSync(`${options.dest}/.git`, { recursive: true, force: true });
  options.onLine(`[git] Checked out ${fullSha.slice(0, 7)} — ${message}`);
  return { sha: fullSha, author, message };
}
