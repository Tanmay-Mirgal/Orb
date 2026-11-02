import { createSign } from 'node:crypto';
import { safeEqual, hmacSha256Hex } from './crypto';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

/** .env files commonly store PEM keys with literal `\n` sequences. */
export function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** RS256 JWT authenticating as the GitHub App itself (valid for 9 minutes). */
export function createAppJwt(appId: string, privateKeyPem: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }));
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(normalizePrivateKey(privateKeyPem));
  return `${header}.${payload}.${base64url(signature)}`;
}

export async function githubFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'orb-platform',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}

export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number | string,
): Promise<string> {
  const jwt = createAppJwt(appId, privateKeyPem);
  const res = await githubFetch(jwt, `/app/installations/${installationId}/access_tokens`, { method: 'POST' });
  if (!res.ok) throw new Error(`GitHub installation token request failed (${res.status})`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Validates `X-Hub-Signature-256` against the raw request body. Missing secret/signature => false. */
export function verifyGithubSignature(rawBody: string | Buffer, header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = `sha256=${hmacSha256Hex(secret, rawBody)}`;
  return safeEqual(expected, header);
}
