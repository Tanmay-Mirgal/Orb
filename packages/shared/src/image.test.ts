import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  imageDisplayName,
  imageReferenceError,
  isBlockedRegistryHost,
  parseImageReference,
  registryAuthKey,
  updateProjectSchema,
} from './index';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('parseImageReference', () => {
  it('resolves bare names to Docker Hub library images', () => {
    expect(parseImageReference('nginx')).toEqual({ registry: 'docker.io', repository: 'library/nginx', tag: null, digest: null });
    expect(parseImageReference('nginx:1.27-alpine')).toMatchObject({ repository: 'library/nginx', tag: '1.27-alpine' });
  });

  it('folds Docker Hub aliases and host case so a saved login can be matched to the registry', () => {
    expect(parseImageReference('index.docker.io/acme/api')?.registry).toBe('docker.io');
    expect(parseImageReference('registry-1.docker.io/library/nginx')?.registry).toBe('docker.io');
    expect(parseImageReference('GHCR.io/acme/api')?.registry).toBe('ghcr.io');
  });

  it('keeps user namespaces on Docker Hub', () => {
    expect(parseImageReference('acme/api:v2')).toEqual({ registry: 'docker.io', repository: 'acme/api', tag: 'v2', digest: null });
  });

  it('recognises registry hosts, ports and digests', () => {
    expect(parseImageReference('ghcr.io/acme/api:latest')).toMatchObject({ registry: 'ghcr.io', repository: 'acme/api', tag: 'latest' });
    expect(parseImageReference('registry.example.com:5000/team/app:1')).toMatchObject({ registry: 'registry.example.com:5000', repository: 'team/app', tag: '1' });
    expect(parseImageReference(`acme/api@${DIGEST}`)).toMatchObject({ repository: 'acme/api', tag: null, digest: DIGEST });
    expect(parseImageReference(`ghcr.io/acme/api:1@${DIGEST}`)).toMatchObject({ tag: '1', digest: DIGEST });
  });

  it('rejects anything that could be read as a docker flag or break the command line', () => {
    for (const bad of ['', ' ', '-v /:/host', '--privileged', 'nginx latest', 'nginx;rm -rf /', 'nginx$(id)', 'NGINX', 'a//b', 'nginx:', 'nginx@sha256:short', 'x'.repeat(300)]) {
      expect(parseImageReference(bad), bad).toBeNull();
    }
  });
});

describe('registry safety', () => {
  it('blocks loopback, private, link-local and single-label hosts', () => {
    for (const host of ['localhost:5000', '127.0.0.1:5000', '10.0.0.5', '192.168.1.10:5000', '172.20.0.2', '169.254.169.254', 'registry:5000', 'redis', 'registry.local', 'foo.internal']) {
      expect(isBlockedRegistryHost(host), host).toBe(true);
    }
  });

  it('allows public registries', () => {
    for (const host of ['docker.io', 'ghcr.io', 'quay.io', 'registry.gitlab.com', '123456789012.dkr.ecr.us-east-1.amazonaws.com', '8.8.8.8:5000']) {
      expect(isBlockedRegistryHost(host), host).toBe(false);
    }
  });

  it('explains unusable references', () => {
    expect(imageReferenceError('nginx:1.27')).toBeNull();
    expect(imageReferenceError('not an image')).toMatch(/Enter an image/);
    expect(imageReferenceError('localhost:5000/app')).toMatch(/not reachable/);
  });

  it('stores Docker Hub logins under the legacy index key', () => {
    expect(registryAuthKey('docker.io')).toBe('https://index.docker.io/v1/');
    expect(registryAuthKey('ghcr.io')).toBe('ghcr.io');
  });
});

describe('imageDisplayName', () => {
  it('uses the last path segment', () => {
    expect(imageDisplayName('ghcr.io/acme/api:1.4')).toBe('api');
    expect(imageDisplayName('nginx')).toBe('nginx');
  });
});

describe('project schemas for Docker images', () => {
  const base = { name: 'My API', type: 'web_service', source: 'image', image: 'ghcr.io/acme/api:1' };

  it('accepts an image project without a repository, with auto port', () => {
    const parsed = createProjectSchema.parse({ ...base, port: 0, envVars: [{ key: 'DATABASE_URL', value: 'x', scope: 'runtime' }] });
    expect(parsed.source).toBe('image');
    expect(parsed.repository).toBeUndefined();
    expect(parsed.envVars?.[0]?.scope).toBe('runtime');
  });

  it('still requires a repository for Git projects', () => {
    const result = createProjectSchema.safeParse({ name: 'My API', type: 'web_service' });
    expect(result.success).toBe(false);
  });

  it('rejects static sites, missing images and unreachable registries', () => {
    expect(createProjectSchema.safeParse({ ...base, type: 'static' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, image: undefined }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, image: 'localhost:5000/app' }).success).toBe(false);
  });

  it('lets an update set or clear the registry login', () => {
    expect(updateProjectSchema.parse({ registry: { username: 'bot', password: 'tok' } }).registry).toEqual({ username: 'bot', password: 'tok' });
    expect(updateProjectSchema.parse({ registry: null }).registry).toBeNull();
    expect(updateProjectSchema.safeParse({ registry: { username: 'a:b', password: 'x' } }).success).toBe(false);
  });
});
