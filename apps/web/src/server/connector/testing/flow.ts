import { createHash, randomBytes } from 'node:crypto';
import type { Harness, TestUser } from './harness';

/** Drives the real OAuth routes (consent decision, token) the way the Hub does. */

export const REDIRECT_URI = 'https://hub.example.com/callback';
export const CLIENT_ID = 'test-hub';
export const CLIENT_SECRET = 'hub-secret-hub-secret-hub-secret-123456';

export const pkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export interface AuthorizeParams {
  scope: string;
  state?: string;
  challenge: string;
  redirectUri?: string;
  clientId?: string;
  method?: string;
  responseType?: string;
}

export const authorizeQuery = (p: AuthorizeParams): Record<string, string> => {
  const q: Record<string, string> = {
    response_type: p.responseType ?? 'code',
    client_id: p.clientId ?? CLIENT_ID,
    redirect_uri: p.redirectUri ?? REDIRECT_URI,
    scope: p.scope,
    code_challenge: p.challenge,
    code_challenge_method: p.method ?? 'S256',
  };
  if (p.state !== undefined) q.state = p.state;
  return q;
};

export async function postDecision(h: Harness, user: TestUser | null, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('@/app/connect/authorize/decision/route');
  h.session.user = user;
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.set(k, v);
  return POST(new Request('https://orb.example.com/connect/authorize/decision', { method: 'POST', body, headers: { host: 'orb.example.com', ...headers } }));
}

export async function tokenRequest(form: Record<string, string>, options: { basic?: boolean; json?: boolean; auth?: boolean } = {}): Promise<Response> {
  const { POST } = await import('@/app/api/connect/v1/oauth/token/route');
  const headers: Record<string, string> = {};
  const payload = { ...form };
  if (options.auth !== false) {
    if (options.basic) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64')}`;
    else Object.assign(payload, { client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  }
  if (options.json) {
    headers['content-type'] = 'application/json';
    return POST(new Request('https://orb.example.com/api/connect/v1/oauth/token', { method: 'POST', headers, body: JSON.stringify(payload) }));
  }
  headers['content-type'] = 'application/x-www-form-urlencoded';
  return POST(new Request('https://orb.example.com/api/connect/v1/oauth/token', { method: 'POST', headers, body: new URLSearchParams(payload).toString() }));
}

export interface Connected {
  access: string;
  refresh: string;
  grantId: string;
  scope: string;
  orgId: string;
  verifier: string;
  response: Record<string, unknown>;
}

/** Consent + code exchange. Returns the tokens of the new grant. */
export async function connect(h: Harness, user: TestUser, orgId: string, scope: string): Promise<Connected> {
  const { verifier, challenge } = pkce();
  const decision = await postDecision(h, user, { ...authorizeQuery({ scope, state: 'st4te', challenge }), org_id: orgId, decision: 'allow' });
  if (decision.status !== 303) throw new Error(`consent failed: ${decision.status} ${await decision.text()}`);
  const location = new URL(decision.headers.get('location')!);
  const code = location.searchParams.get('code');
  if (!code) throw new Error(`no code in ${location.toString()}`);
  const res = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
  const { eq } = await import('drizzle-orm');
  const { connectorGrants } = await import('database/src/schema');
  const [grant] = await h.db.select({ id: connectorGrants.id }).from(connectorGrants).where(eq(connectorGrants.accessHash, (await import('core')).hashConnectorToken(body.access_token))).limit(1);
  return { access: body.access_token, refresh: body.refresh_token, grantId: grant!.id, scope: body.scope, orgId, verifier, response: body };
}

/** Calls a route handler (connector or dashboard) with an optional bearer token. */
export async function call<P extends Record<string, string> = Record<string, never>>(
  handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>,
  path: string,
  options: { token?: string; method?: string; body?: unknown; headers?: Record<string, string>; params?: P } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return handler(
    new Request(`https://orb.example.com${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
    { params: Promise.resolve((options.params ?? {}) as P) },
  );
}
