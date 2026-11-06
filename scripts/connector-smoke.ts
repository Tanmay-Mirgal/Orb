/**
 * End-to-end smoke test of the ecosystem connector against a RUNNING Orb (never against production data you care about).
 *
 *   ORB_URL=http://localhost:3000 HUB_CLIENT_ID=hub HUB_CLIENT_SECRET=… \
 *   SMOKE_REPO=owner/repo npm run connector:smoke
 *
 * It plays the Hub: reads the manifest, runs the PKCE consent flow (you click Allow once in the browser; the script
 * listens on HUB_REDIRECT_URI, default http://localhost:8787/callback, which must be in CONNECTOR_HUB_REDIRECT_URIS),
 * calls /me and the read resources, registers a webhook on its own receiver (needs CONNECTOR_ALLOW_PRIVATE_WEBHOOKS=true
 * on a development Orb), and, when SMOKE_REPO is set, creates a project, waits for the deployment and checks that the
 * signed `deployment.*` webhooks and GET /events agree. It revokes its grant at the end.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const ORB = (process.env.ORB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const CLIENT_ID = process.env.HUB_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.HUB_CLIENT_SECRET ?? '';
const REDIRECT = process.env.HUB_REDIRECT_URI ?? 'http://localhost:8787/callback';
const REPO = process.env.SMOKE_REPO;
const API = `${ORB}/api/connect/v1`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set HUB_CLIENT_ID and HUB_CLIENT_SECRET (the values of CONNECTOR_HUB_CLIENT_ID / _SECRET).');
  process.exit(2);
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail && !ok ? `  → ${detail}` : ''}`);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; headers: Headers }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json, headers: res.headers };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- local receiver: OAuth callback + webhook endpoint -----------------------------------------------------------------
const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
let codePromiseResolve: (v: { code: string; state: string }) => void = () => undefined;
const codePromise = new Promise<{ code: string; state: string }>((r) => (codePromiseResolve = r));

const redirectUrl = new URL(REDIRECT);
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT);
  if (url.pathname === redirectUrl.pathname) {
    const error = url.searchParams.get('error');
    res.setHeader('content-type', 'text/plain');
    res.end(error ? `Orb answered: ${error}` : 'Connected. You can close this tab.');
    if (error) console.error(`authorization failed: ${error} ${url.searchParams.get('error_description') ?? ''}`);
    else codePromiseResolve({ code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '' });
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.end('ok');
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(Number(redirectUrl.port) || 8787, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  console.log(`\nOrb ecosystem connector smoke test → ${ORB}\n`);

  // 1. discovery
  const manifest = (await (await fetch(`${ORB}/.well-known/ecosystem-connector.json`)).json()) as Json;
  check('manifest: protocol cp1, service orb', manifest.protocol === 'cp1' && manifest.service === 'orb');
  check('manifest: actions, resources and events listed', manifest.actions?.length > 0 && manifest.resources?.length > 0 && manifest.events?.length > 0);
  const health = await call('GET', '/health');
  check('health', health.status === 200 && health.body.status === 'ok');

  // 2. consent (PKCE) — the human clicks Allow
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  const scopes = process.env.SMOKE_SCOPES ?? (manifest.auth.scopes as Array<{ name: string }>).map((s) => s.name).join(' ');
  const authorize = new URL(manifest.auth.authorizeUrl);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: scopes, state, code_challenge: challenge, code_challenge_method: 'S256' })) authorize.searchParams.set(k, v);
  console.log(`\nOpen this URL, sign in to Orb and click Allow (5 minutes):\n\n  ${authorize.toString()}\n`);
  const got = await Promise.race([codePromise, sleep(5 * 60_000).then(() => null)]);
  if (!got) throw new Error('timed out waiting for the consent');
  check('consent: state is echoed', got.state === state);

  const tokenRes = await fetch(manifest.auth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: got.code, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
  });
  const tokens = (await tokenRes.json()) as Json;
  check('token: access + refresh issued, pinned to one team', tokenRes.status === 200 && String(tokens.access_token).startsWith('cp1_orb_') && tokens.tenant?.kind === 'organization', JSON.stringify(tokens));
  if (tokenRes.status !== 200) throw new Error('cannot continue without tokens');
  let access = tokens.access_token as string;

  // 3. identity and reads
  const me = await call('GET', '/me', access);
  check('/me: user, tenant, scopes, plan, capabilities', me.status === 200 && me.body.tenant?.id === tokens.tenant.id && Array.isArray(me.body.scopes) && !!me.body.capabilities);
  check('rate limit headers present', !!me.headers.get('x-ratelimit-limit'));
  const projects = await call('GET', '/projects?limit=5', access);
  check('projects.list: { items, nextCursor }', projects.status === 200 && Array.isArray(projects.body.items) && 'nextCursor' in projects.body);
  check('usage', (await call('GET', '/usage', access)).status === 200);
  const bad = await call('GET', '/projects/00000000-0000-0000-0000-000000000000', access);
  check('unknown id → 404 in the CP1 error shape', bad.status === 404 && bad.body.error?.code === 'not_found' && !!bad.body.error?.requestId);

  // 4. refresh rotation
  const refreshed = await fetch(manifest.auth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString(),
  });
  const next = (await refreshed.json()) as Json;
  check('refresh: rotates the refresh token', refreshed.status === 200 && next.refresh_token !== tokens.refresh_token);
  access = next.access_token as string;

  // 5. webhook registration
  const hook = await call('POST', '/webhooks', access, { url: hookUrl, events: ['project.*', 'deployment.*'], description: 'smoke test' });
  let secret: string | undefined;
  if (hook.status === 201) {
    secret = hook.body.secret as string;
    check('webhook registered, secret returned once', secret.startsWith('whsec_') && !('secret' in (await call('GET', `/webhooks/${hook.body.id}`, access)).body));
  } else {
    check('webhook registration (needs CONNECTOR_ALLOW_PRIVATE_WEBHOOKS=true on a dev Orb)', false, JSON.stringify(hook.body));
  }

  // 6. create a project and follow the deployment
  if (REPO) {
    const key = `smoke-${Date.now()}`;
    const input = { name: `smoke-${Date.now().toString(36)}`, type: 'static', repository: { fullName: REPO }, externalRef: { hubProjectId: 'smoke', hubRunId: key } };
    const created = await call('POST', '/actions/projects.create', access, { input }, { 'idempotency-key': key });
    check('projects.create', created.status === 200 && !!created.body.output?.project?.id, JSON.stringify(created.body));
    const replay = await call('POST', '/actions/projects.create', access, { input }, { 'idempotency-key': key });
    check('idempotent replay', replay.headers.get('idempotent-replay') === 'true' && replay.body.output?.project?.id === created.body.output?.project?.id);
    for (const w of created.body.output?.warnings ?? []) console.log(`  note  ${w.code}: ${w.message}${w.fixUrl ? ` (${w.fixUrl})` : ''}`);

    const deployment = created.body.output?.deployment;
    if (deployment) {
      const op = await call('POST', '/actions/projects.waitForDeployment', access, { input: { deploymentId: deployment.id, timeoutSeconds: 600 } });
      check('waitForDeployment answers 202', op.status === 202);
      let final: Json = {};
      for (let i = 0; i < 300; i++) {
        final = (await call('GET', `/operations/${op.body.operation.id}`, access)).body;
        if (['succeeded', 'failed', 'canceled'].includes(final.status)) break;
        await sleep(2000);
      }
      check(`operation finished (deployment ${final.output?.deployment?.status ?? final.status})`, final.status === 'succeeded');
      await sleep(8000); // let the dispatcher deliver
    }

    // 7. webhooks and the event log must agree
    if (secret) {
      let signaturesOk = received.length > 0;
      for (const { headers, body } of received) {
        const ts = String(headers['x-cp-timestamp']);
        const expected = `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
        const given = String(headers['x-cp-signature']);
        signaturesOk &&= given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      }
      check(`webhooks: ${received.length} delivered, all signatures valid`, signaturesOk);
      const log = await call('GET', '/events?limit=200', access);
      const logged = new Set((log.body.items as Json[]).map((e) => e.id));
      const missing = received.map((r) => (JSON.parse(r.body) as Json).id).filter((id) => !logged.has(id));
      check('GET /events replays every delivered event', log.status === 200 && missing.length === 0, missing.join(','));
      const correlated = received.map((r) => JSON.parse(r.body) as Json).filter((e) => e.type.startsWith('deployment.'));
      check('deployment events echo externalRef', correlated.length > 0 && correlated.every((e) => e.externalRef?.hubProjectId === 'smoke'));
    }
  } else {
    console.log('  skip  create/deploy/webhook flow (set SMOKE_REPO=owner/repo to include it)');
  }

  // 8. revoke
  await fetch(manifest.auth.revokeUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: access }).toString() });
  check('revoke is immediate', (await call('GET', '/me', access)).status === 401);
}

main()
  .catch((err) => {
    check('smoke test ran to completion', false, err instanceof Error ? err.message : String(err));
  })
  .finally(() => {
    server.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length > 0 ? 1 : 0);
  });
