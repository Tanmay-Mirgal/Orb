import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  detectProject,
  evaluateRoutes,
  headersForPath,
  isValidCustomDomain,
  normalizeDomain,
  normalizeRelativeDir,
  parseDotenv,
  parseOrbConfig,
  pickNodeMajor,
  shellQuote,
  slugify,
  toShellEnvFile,
  type FileProbe,
} from './index';

function probe(files: Record<string, string>): FileProbe {
  return {
    exists: async (p) => p in files,
    read: async (p) => files[p],
  };
}

describe('detectProject', () => {
  it('detects Next.js as a web service using the lockfile package manager', async () => {
    const d = await detectProject(
      probe({
        'package.json': JSON.stringify({ dependencies: { next: '16.0.0' }, scripts: { build: 'next build', start: 'next start' } }),
        'pnpm-lock.yaml': '',
      }),
    );
    expect(d.framework).toBe('nextjs');
    expect(d.suggestedType).toBe('web_service');
    expect(d.installCommand).toBe('pnpm install --frozen-lockfile');
    expect(d.startCommand).toBe('pnpm run start');
  });

  it('detects Vite as a static site and honours rootDirectory', async () => {
    const d = await detectProject(
      probe({
        'web/package.json': JSON.stringify({ devDependencies: { vite: '6' }, scripts: { build: 'vite build' } }),
        'web/package-lock.json': '{}',
        'web/.nvmrc': 'v20.11.1',
      }),
      'web',
    );
    expect(d.suggestedType).toBe('static');
    expect(d.outputDirectory).toBe('dist');
    expect(d.installCommand).toBe('npm ci');
    expect(d.nodeMajor).toBe(20);
  });

  it('detects Express, Flask and Dockerfile projects', async () => {
    expect((await detectProject(probe({ 'package.json': JSON.stringify({ dependencies: { express: '5' }, scripts: { start: 'node server.js' } }) }))).framework).toBe('express');
    const flask = await detectProject(probe({ 'requirements.txt': 'Flask==3\ngunicorn' }));
    expect(flask.framework).toBe('flask');
    expect(flask.startCommand).toContain('gunicorn');
    const docker = await detectProject(probe({ Dockerfile: 'FROM alpine\nEXPOSE 9000' }));
    expect(docker.framework).toBe('dockerfile');
    expect(docker.port).toBe(9000);
  });

  it('falls back to plain static HTML', async () => {
    expect((await detectProject(probe({ 'index.html': '<html/>' }))).framework).toBe('static-html');
  });
});

describe('pickNodeMajor', () => {
  it('maps version specs onto supported majors', () => {
    expect(pickNodeMajor('v20.11.1')).toBe(20);
    expect(pickNodeMajor('>=18')).toBe(22);
    expect(pickNodeMajor('16')).toBe(18);
    expect(pickNodeMajor('lts/*')).toBe(22);
    expect(pickNodeMajor('30')).toBe(24);
    expect(pickNodeMajor(undefined)).toBe(22);
  });
});

describe('orb.json routing', () => {
  const { config } = parseOrbConfig(
    JSON.stringify({
      redirects: [{ source: '/old/:slug', destination: '/new/:slug', permanent: true }],
      rewrites: [{ source: '/docs/*', destination: '/guides/:splat' }],
      headers: [{ source: '/*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }],
    }),
  );
  it('redirects, rewrites and sets headers', () => {
    expect(evaluateRoutes(config, '/old/hello')).toEqual({ type: 'redirect', location: '/new/hello', status: 301 });
    expect(evaluateRoutes(config, '/docs/a/b')).toEqual({ type: 'rewrite', path: '/guides/a/b' });
    expect(evaluateRoutes(config, '/other')).toEqual({ type: 'pass' });
    expect(headersForPath(config, '/anything/here')).toEqual([['X-Frame-Options', 'DENY']]);
  });
  it('rejects invalid config', () => {
    expect(parseOrbConfig('{nope').error).toMatch(/valid JSON/);
    expect(parseOrbConfig(JSON.stringify({ headers: [{ source: '/', headers: [{ key: 'X', value: 'a\nb' }] }] })).error).toBeDefined();
  });
});

describe('env helpers', () => {
  it('parses pasted .env content', () => {
    const { vars, skipped } = parseDotenv('# c\nexport A=1\nB="two words"\nC=x=y # trailing\n1BAD=nope\nPORT=1');
    expect(vars).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: 'two words' },
      { key: 'C', value: 'x=y' },
    ]);
    expect(skipped).toEqual(['1BAD', 'PORT']);
  });
  it('quotes values safely for sh', () => {
    expect(shellQuote("it's $HOME `x`")).toBe(`'it'\\''s $HOME \`x\`'`);
    expect(toShellEnvFile({ OK: 'a b', 'BAD KEY;rm': 'x' })).toBe("export OK='a b'\n");
  });
  it('redacts secrets from log lines', () => {
    const redact = createRedactor(['supersecret', 'abc']);
    expect(redact('token=supersecret abc')).toBe('token=*** abc');
  });
});

describe('naming and domains', () => {
  it('slugifies and validates', () => {
    expect(slugify('My Cool App!!')).toBe('my-cool-app');
    expect(slugify('!!!')).toBe('project');
    expect(normalizeRelativeDir('./apps//web/')).toBe('apps/web');
    expect(normalizeRelativeDir('../etc')).toBeNull();
    expect(normalizeRelativeDir('/abs')).toBeNull();
    expect(normalizeDomain('https://Example.COM:8080/path?x=1')).toBe('example.com');
    expect(isValidCustomDomain('app.example.com', 'orb.dev')).toBe(true);
    expect(isValidCustomDomain('x.orb.dev', 'orb.dev')).toBe(false);
    expect(isValidCustomDomain('not a domain', 'orb.dev')).toBe(false);
  });
});
