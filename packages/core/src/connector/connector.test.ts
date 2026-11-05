import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  MAX_DELIVERY_ATTEMPTS,
  REFRESH_TOKEN_TTL_SECONDS,
  RETRY_DELAYS_SECONDS,
  assertConnectorConfig,
  assertPublicWebhookUrl,
  connectorConfigProblems,
  connectorTokenKind,
  decryptConnectorSecret,
  encryptConnectorSecret,
  generateAuthorizationCode,
  generateConnectorToken,
  generateWebhookSecret,
  hashConnectorToken,
  isAcceptableRedirectUri,
  isBlockedAddress,
  newEventId,
  parseWebhookUrl,
  pkceChallengeS256,
  postWebhook,
  retryDelayMs,
  signWebhook,
  ulid,
  verifyPkceS256,
  verifyWebhookSignature,
  webhookHeaders,
} from '../index';

const PEPPER = 'p'.repeat(40);
const KEY = 'k'.repeat(40);

describe('connector tokens', () => {
  it('are opaque, prefixed, at least 32 random bytes and hashed with the pepper', () => {
    const { token, hash } = generateConnectorToken('access', PEPPER);
    expect(token.startsWith('cp1_orb_')).toBe(true);
    expect(token.length - 'cp1_orb_'.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(hash).toBe(hashConnectorToken(token, PEPPER));
    expect(hash).not.toBe(hashConnectorToken(token, `${PEPPER}x`));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(hash);
  });
  it('never repeat and have distinct prefixes per kind', () => {
    const a = generateConnectorToken('refresh', PEPPER).token;
    const b = generateConnectorToken('refresh', PEPPER).token;
    expect(a).not.toBe(b);
    expect(connectorTokenKind(a)).toBe('refresh');
    expect(connectorTokenKind(generateConnectorToken('access', PEPPER).token)).toBe('access');
    expect(connectorTokenKind(generateConnectorToken('key', PEPPER).token)).toBe('key');
    expect(connectorTokenKind('orb_abc')).toBeNull();
  });
  it('use the TTLs of the spec', () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(90 * 86400);
    expect(AUTH_CODE_TTL_SECONDS).toBe(60);
  });
  it('hash authorization codes in a different domain than tokens', () => {
    const { code, hash } = generateAuthorizationCode(PEPPER);
    expect(code.length).toBeGreaterThanOrEqual(43);
    expect(hash).not.toBe(hashConnectorToken(code, PEPPER));
  });
});

describe('PKCE (C02)', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  it('accepts the RFC 7636 example', () => {
    expect(pkceChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifyPkceS256(verifier, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
  });
  it('rejects a wrong or malformed verifier', () => {
    expect(verifyPkceS256(`${verifier}x`, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(verifyPkceS256('short', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(verifyPkceS256(verifier, 'not-a-challenge')).toBe(false);
  });
});

describe('secret box', () => {
  beforeEach(() => {
    process.env.CONNECTOR_ENCRYPTION_KEY = KEY;
    delete process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS;
  });
  it('round-trips, binds to the row and never stores plaintext', () => {
    const stored = encryptConnectorSecret('whsec_abc', 'webhook-1');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('whsec_abc');
    expect(decryptConnectorSecret(stored, 'webhook-1')).toBe('whsec_abc');
    expect(() => decryptConnectorSecret(stored, 'webhook-2')).toThrow();
  });
  it('still reads rows written with a previous key after rotation', () => {
    const stored = encryptConnectorSecret('whsec_old', 'w');
    process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS = KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'n'.repeat(40);
    expect(decryptConnectorSecret(stored, 'w')).toBe('whsec_old');
    const fresh = encryptConnectorSecret('whsec_new', 'w');
    expect(fresh.split(':')[2]).not.toBe(stored.split(':')[2]); // new key id
  });
});

describe('webhook signing (C15)', () => {
  it('signs "<timestamp>.<rawBody>" with HMAC-SHA256 and verifies', () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith('whsec_')).toBe(true);
    const body = JSON.stringify({ id: 'evt_1' });
    const sig = signWebhook(secret, 1_700_000_000, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, '1700000000', body, sig, { nowMs: 1_700_000_100_000 })).toBe(true);
    expect(verifyWebhookSignature(secret, '1700000000', `${body} `, sig, { nowMs: 1_700_000_100_000 })).toBe(false);
    expect(verifyWebhookSignature(secret, '1700000000', body, sig, { nowMs: 1_700_001_000_000 })).toBe(false); // stale
    expect(verifyWebhookSignature('whsec_other', '1700000000', body, sig, { nowMs: 1_700_000_100_000 })).toBe(false);
  });
  it('sets the documented headers', () => {
    const headers = webhookHeaders({ type: 'deployment.ready', deliveryId: 'd1', timestamp: 5, signature: 'v1=x' });
    expect(headers).toMatchObject({ 'X-CP-Event': 'deployment.ready', 'X-CP-Delivery': 'd1', 'X-CP-Timestamp': '5', 'X-CP-Signature': 'v1=x', 'User-Agent': 'Orb-Connector/1.0' });
  });
});

describe('retry schedule (C16)', () => {
  it('is 10s, 30s, 2m, 10m, 30m, 1h, 3h, 6h', () => {
    expect([...RETRY_DELAYS_SECONDS]).toEqual([10, 30, 120, 600, 1800, 3600, 10800, 21600]);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(9);
    expect(RETRY_DELAYS_SECONDS.reduce((a, b) => a + b, 0) / 3600).toBeCloseTo(10.72, 1);
  });
  it('applies ±20% jitter and stops after the last retry', () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(10_000);
    expect(retryDelayMs(1, () => 0)).toBe(8_000);
    expect(retryDelayMs(1, () => 1)).toBe(12_000);
    expect(retryDelayMs(8, () => 0.5)).toBe(21_600_000);
    expect(retryDelayMs(9)).toBeNull();
  });
});

describe('SSRF guard (C17)', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00:ec2::254', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', 'ff02::1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  const prod = { production: true, allowPrivate: false };
  it('requires https and rejects credentials, fragments and private-looking hosts', () => {
    expect(() => parseWebhookUrl('http://hooks.example.com/x', prod)).toThrow(/https/);
    expect(() => parseWebhookUrl('https://user:pw@hooks.example.com/x', prod)).toThrow(/credentials/);
    expect(() => parseWebhookUrl('https://hooks.example.com/x#frag', prod)).toThrow(/fragment/);
    expect(() => parseWebhookUrl('https://localhost/x', prod)).toThrow(/public/);
    expect(() => parseWebhookUrl('https://metadata.internal/x', prod)).toThrow(/public/);
    expect(() => parseWebhookUrl('https://intranet/x', prod)).toThrow(/public/);
    expect(() => parseWebhookUrl('https://169.254.169.254/latest/meta-data', prod)).toThrow(/private/);
    expect(() => parseWebhookUrl('https://[::1]/x', prod)).toThrow(/private/);
    expect(parseWebhookUrl('https://hooks.example.com/x', prod).hostname).toBe('hooks.example.com');
  });
  it('resolves DNS and rejects names that point at private addresses', async () => {
    await expect(assertPublicWebhookUrl('https://evil.example.com/x', prod, async () => ['10.0.0.8'])).rejects.toThrow(/private/);
    await expect(assertPublicWebhookUrl('https://mixed.example.com/x', prod, async () => ['8.8.8.8', '127.0.0.1'])).rejects.toThrow(/private/);
    await expect(assertPublicWebhookUrl('https://nx.example.com/x', prod, async () => { throw new Error('nxdomain'); })).rejects.toThrow(/resolve/);
    await expect(assertPublicWebhookUrl('https://ok.example.com/x', prod, async () => ['93.184.216.34'])).resolves.toBeInstanceOf(URL);
  });
  it('never honours the private-network escape hatch in production', () => {
    const original = process.env.NODE_ENV;
    expect(() => parseWebhookUrl('http://localhost:9/x', { production: true, allowPrivate: true })).toThrow(/https/);
    expect(parseWebhookUrl('http://localhost:9/x', { production: false, allowPrivate: true }).hostname).toBe('localhost');
    process.env.NODE_ENV = original;
  });
});

describe('postWebhook', () => {
  let server: http.Server;
  let received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  let respond: (res: http.ServerResponse) => void = (res) => res.end('ok');
  beforeEach(async () => {
    received = [];
    respond = (res) => res.end('ok');
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        respond(res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  const dev = { production: false, allowPrivate: true };
  const urlOf = () => new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`);

  it('POSTs the raw body with headers and reports the status', async () => {
    const res = await postWebhook({ url: urlOf(), body: '{"a":1}', headers: { 'Content-Type': 'application/json', 'X-CP-Event': 't' }, policy: dev });
    expect(res).toEqual({ status: 200, excerpt: 'ok' });
    expect(received[0]!.body).toBe('{"a":1}');
    expect(received[0]!.headers['x-cp-event']).toBe('t');
  });
  it('does not follow redirects', async () => {
    respond = (res) => {
      res.statusCode = 302;
      res.setHeader('Location', 'http://127.0.0.1:1/elsewhere');
      res.end();
    };
    const res = await postWebhook({ url: urlOf(), body: '{}', headers: {}, policy: dev });
    expect(res.status).toBe(302);
    expect(received).toHaveLength(1);
  });
  it('times out a hanging receiver', async () => {
    respond = () => undefined;
    await expect(postWebhook({ url: urlOf(), body: '{}', headers: {}, policy: dev, totalTimeoutMs: 150 })).rejects.toThrow(/timed out/);
  });
  it('refuses to connect to a private address when private targets are not allowed', async () => {
    await expect(postWebhook({ url: urlOf(), body: '{}', headers: {}, policy: { production: false, allowPrivate: false } })).rejects.toThrow();
    expect(received).toHaveLength(0);
  });
});

describe('ULID', () => {
  it('is 26 chars and sorts in creation order, even within a millisecond', () => {
    const ids = Array.from({ length: 200 }, () => ulid(1_700_000_000_000));
    expect(ids.every((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(200);
    expect(ulid(1_700_000_000_001) > ids[199]!).toBe(true);
  });
  it('prefixes event ids', () => {
    expect(newEventId()).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('connector config (fail fast)', () => {
  const names = ['CONNECTOR_ENABLED', 'CONNECTOR_HUB_CLIENT_ID', 'CONNECTOR_HUB_CLIENT_SECRET', 'CONNECTOR_HUB_REDIRECT_URIS', 'CONNECTOR_TOKEN_PEPPER', 'CONNECTOR_ENCRYPTION_KEY'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const n of names) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
  });
  afterEach(() => {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });
  it('is silent while disabled', () => {
    expect(connectorConfigProblems()).toEqual([]);
    expect(() => assertConnectorConfig()).not.toThrow();
  });
  it('lists every missing variable when enabled', () => {
    process.env.CONNECTOR_ENABLED = 'true';
    const problems = connectorConfigProblems().join('\n');
    for (const n of ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URIS', 'TOKEN_PEPPER', 'ENCRYPTION_KEY']) expect(problems).toContain(n);
    expect(() => assertConnectorConfig()).toThrow(/CONNECTOR_ENABLED=true/);
  });
  it('accepts a complete configuration', () => {
    Object.assign(process.env, {
      CONNECTOR_ENABLED: 'true',
      CONNECTOR_HUB_CLIENT_ID: 'hub',
      CONNECTOR_HUB_CLIENT_SECRET: 's'.repeat(40),
      CONNECTOR_HUB_REDIRECT_URIS: 'https://hub.example.com/callback, http://localhost:3100/cb',
      CONNECTOR_TOKEN_PEPPER: PEPPER,
      CONNECTOR_ENCRYPTION_KEY: KEY,
    });
    expect(connectorConfigProblems()).toEqual([]);
  });
  it('validates redirect URIs', () => {
    expect(isAcceptableRedirectUri('https://hub.example.com/cb', true)).toBe(true);
    expect(isAcceptableRedirectUri('http://hub.example.com/cb', false)).toBe(false);
    expect(isAcceptableRedirectUri('http://localhost:3100/cb', false)).toBe(true);
    expect(isAcceptableRedirectUri('http://localhost:3100/cb', true)).toBe(false);
    expect(isAcceptableRedirectUri('https://hub.example.com/cb#frag', true)).toBe(false);
    expect(isAcceptableRedirectUri('not a url', false)).toBe(false);
  });
});
