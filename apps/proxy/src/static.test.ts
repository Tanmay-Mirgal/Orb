import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStorage, storageKeys } from 'storage';
import { proxyConfig } from './config';
import { RouteResolver } from './routes';
import { StaticHandler } from './static';

let server: http.Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-static-test-'));
  const storage = new FsStorage(root);
  await storage.ensureReady();
  const files: Record<string, string> = {
    'index.html': '<h1>home</h1>',
    'about.html': '<h1>about</h1>',
    'docs/index.html': '<h1>docs</h1>',
    '404.html': '<h1>custom 404</h1>',
    'assets/app.4f9a1c2b.js': 'console.log(1)',
  };
  const manifest = {
    version: 1,
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { size: v.length, type: k.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }])),
    config: {
      redirects: [{ source: '/old/:slug', destination: '/new/:slug', permanent: true }],
      rewrites: [{ source: '/team', destination: '/about' }],
      headers: [{ source: '/*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }],
    },
  };
  for (const [k, v] of Object.entries(files)) await storage.put(storageKeys.siteFile('dep1', k), v);
  await storage.put(storageKeys.siteManifest('dep1'), JSON.stringify(manifest));

  const handler = new StaticHandler(storage, proxyConfig());
  server = http.createServer((req, res) => void handler.handle(req, res, 'dep1'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
});

const get = (p: string, init?: RequestInit) => fetch(base + p, { redirect: 'manual', ...init });

describe('StaticHandler', () => {
  it('serves index, clean URLs and directory indexes', async () => {
    expect(await (await get('/')).text()).toBe('<h1>home</h1>');
    expect(await (await get('/about')).text()).toBe('<h1>about</h1>');
    expect(await (await get('/docs/')).text()).toBe('<h1>docs</h1>');
  });

  it('applies orb.json redirects, rewrites and headers', async () => {
    const redirect = await get('/old/hello');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/new/hello');
    expect(await (await get('/team')).text()).toBe('<h1>about</h1>');
    expect((await get('/')).headers.get('x-frame-options')).toBe('DENY');
  });

  it('uses the custom 404 page and rejects path traversal', async () => {
    const missing = await get('/nope');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('<h1>custom 404</h1>');
    const traversal = await new Promise<number>((resolve) => http.get({ host: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/a%2f..%2fsecret' }, (r) => { r.resume(); resolve(r.statusCode ?? 0); }));
    expect(traversal).toBe(400); // encoded slashes are not normalised by the URL parser, so the handler must reject them itself
    expect((await fetch(base + '/', { method: 'POST' })).status).toBe(405);
  });

  it('sets immutable caching for fingerprinted assets and supports conditional requests', async () => {
    const asset = await get('/assets/app.4f9a1c2b.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await get('/')).headers.get('cache-control')).toContain('must-revalidate');
    const etag = asset.headers.get('etag');
    expect(etag).toBeTruthy();
    expect((await get('/assets/app.4f9a1c2b.js', { headers: { 'if-none-match': etag! } })).status).toBe(304);
  });
});

describe('RouteResolver', () => {
  it('invalidates cached routes per project', () => {
    const resolver = new RouteResolver({} as never, proxyConfig());
    expect(() => resolver.invalidate({ projectId: 'x' })).not.toThrow();
    expect(() => resolver.invalidate({ all: true })).not.toThrow();
  });
});
