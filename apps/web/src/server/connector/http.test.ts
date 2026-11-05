import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../api';
import { ConnectResponse, connectRoute, requestIdOf, toConnectorError } from './http';
import { healthRoute, manifestRoute, openApiRoute } from './discovery';

const call = (handler: (req: Request, ctx?: { params: Promise<never> }) => Promise<Response>, path = '/api/connect/v1/manifest', headers: Record<string, string> = {}) =>
  handler(new Request(`https://orb.example.com${path}`, { headers }));

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('feature flag (C22)', () => {
  it.each([
    ['manifest', manifestRoute],
    ['openapi', openApiRoute],
    ['health', healthRoute],
  ])('answers 404 in the CP1 error shape for %s while the connector is off', async (_name, handler) => {
    const res = await call(handler);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'not_found', retryable: false });
    expect(body.error.requestId).toMatch(/^req_/);
    expect(res.headers.get('x-request-id')).toBe(body.error.requestId);
  });

  it('treats anything but "true" as off', async () => {
    vi.stubEnv('CONNECTOR_ENABLED', 'no');
    expect((await call(healthRoute)).status).toBe(404);
  });
});

describe('discovery (enabled)', () => {
  beforeEach(() => {
    vi.stubEnv('CONNECTOR_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://orb.example.com');
    vi.stubEnv('BETTER_AUTH_URL', 'https://orb.example.com');
  });

  it('serves the manifest, cacheable for five minutes, without CORS headers', async () => {
    const res = await call(manifestRoute);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const manifest = await res.json();
    expect(manifest).toMatchObject({ protocol: 'cp1', service: 'orb', tenantKind: 'organization', baseUrl: 'https://orb.example.com' });
    expect(manifest.actions.length).toBeGreaterThan(10);
  });

  it('serves the same document on both URLs', async () => {
    const a = await (await call(manifestRoute, '/.well-known/ecosystem-connector.json')).json();
    const b = await (await call(manifestRoute)).json();
    expect(a).toEqual(b);
  });

  it('serves OpenAPI 3.1 and a secret-free health check', async () => {
    expect((await (await call(openApiRoute)).json()).openapi).toBe('3.1.0');
    const health = await (await call(healthRoute)).json();
    expect(Object.keys(health).sort()).toEqual(['status', 'time', 'version']);
    expect(health.status).toBe('ok');
  });

  it('echoes a sane X-Request-Id and replaces a hostile one', async () => {
    expect((await call(healthRoute, '/api/connect/v1/health', { 'x-request-id': 'abc-123' })).headers.get('x-request-id')).toBe('abc-123');
    const evil = await call(healthRoute, '/api/connect/v1/health', { 'x-request-id': 'bad id; <script>' });
    expect(evil.headers.get('x-request-id')).toMatch(/^req_/);
    expect(requestIdOf(new Request('https://x.test', { headers: { 'x-request-id': 'a'.repeat(200) } }))).toMatch(/^req_/);
  });
});

describe('error shape (C11)', () => {
  beforeEach(() => vi.stubEnv('CONNECTOR_ENABLED', 'true'));

  const run = async (handler: () => Promise<unknown>) => {
    const route = connectRoute(handler);
    return route(new Request('https://orb.example.com/api/connect/v1/x'));
  };

  it('maps zod failures to validation_failed with details', async () => {
    const res = await run(async () => z.object({ title: z.string() }).parse({}));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatchObject({ code: 'validation_failed', retryable: false });
    expect(error.details[0]).toMatchObject({ path: 'title' });
  });

  it('maps dashboard ApiErrors to CP1 codes', () => {
    expect(toConnectorError(new ApiError(402, 'Your Hobby plan allows up to 5 projects', 'plan_limit')).code).toBe('plan_limit');
    expect(toConnectorError(new ApiError(400, 'No GitHub account is linked', 'github_not_linked'))).toMatchObject({ code: 'precondition_failed', status: 412, extra: { reason: 'github_not_connected' } });
    expect(toConnectorError(new ApiError(409, 'Deployment is already ready', 'conflict')).code).toBe('conflict');
    expect(toConnectorError(new ApiError(404, 'Project not found', 'not_found')).code).toBe('not_found');
    expect(toConnectorError(new ApiError(502, 'GitHub API error (500)', 'github_error')).code).toBe('upstream_failed');
    const limited = toConnectorError(new ApiError(429, 'Too many', 'rate_limited', { retryAfter: 7 }));
    expect(limited).toMatchObject({ code: 'rate_limited', status: 429, headers: { 'Retry-After': '7' } });
    expect(toConnectorError(new ApiError(429, 'queue', 'queue_full')).retryable).toBe(true);
  });

  it('retryable is true only for 429/502/503/5xx', () => {
    expect(toConnectorError(new ApiError(400, 'x', 'bad_request')).retryable).toBe(false);
    expect(toConnectorError(new ApiError(404, 'x', 'not_found')).retryable).toBe(false);
    expect(toConnectorError(new ApiError(502, 'x', 'github_error')).retryable).toBe(true);
    expect(toConnectorError(new Error('boom')).retryable).toBe(true);
  });

  it('hides internal failures and logs them once without secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await run(async () => {
      throw new Error('select * from secrets failed');
    });
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toMatchObject({ code: 'internal', message: 'Internal error', retryable: true });
    expect(JSON.stringify(error)).not.toContain('secrets');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain(error.requestId);
  });

  it('lets handlers choose status and headers', async () => {
    const res = await run(async () => new ConnectResponse({ operation: { id: 'op' } }, { status: 202, headers: { 'x-extra': '1' } }));
    expect(res.status).toBe(202);
    expect(res.headers.get('x-extra')).toBe('1');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
