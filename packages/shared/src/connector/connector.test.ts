import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  EVENTS,
  RESOURCES,
  buildManifest,
  buildOpenApi,
  eventMatchesFilter,
  grantableScopes,
  isValidEventFilter,
  parseScopeParam,
  projectsCreateInput,
  toJsonSchema,
} from '../index';

const manifest = buildManifest({ baseUrl: 'https://orb.example.com/' });

describe('CP1 manifest (C01)', () => {
  it('has the protocol envelope', () => {
    expect(manifest.protocol).toBe('cp1');
    expect(manifest.service).toBe('orb');
    expect(manifest.tenantKind).toBe('organization');
    expect(manifest.baseUrl).toBe('https://orb.example.com');
    expect(manifest.auth.authorizeUrl).toBe('https://orb.example.com/connect/authorize');
    expect(manifest.auth.tokenUrl).toBe('https://orb.example.com/api/connect/v1/oauth/token');
    expect(manifest.auth.revokeUrl).toBe('https://orb.example.com/api/connect/v1/oauth/revoke');
    expect(manifest.limits).toEqual({ requestsPerMinute: 120, maxBodyBytes: 1048576, webhookMaxEndpoints: 5 });
    expect(manifest.links.openapi).toBe('/api/connect/v1/openapi.json');
  });

  it('is generated from the registry: every action, resource and event is listed', () => {
    expect(manifest.actions.map((a) => a.name).sort()).toEqual(Object.keys(ACTIONS).sort());
    expect(manifest.resources.map((r) => r.name).sort()).toEqual(Object.keys(RESOURCES).sort());
    expect(manifest.events.map((e) => e.type)).toEqual(EVENTS.map((e) => e.type));
  });

  it('only references declared scopes', () => {
    const declared = new Set(manifest.auth.scopes.map((s) => s.name));
    for (const item of [...manifest.actions, ...manifest.resources, ...manifest.events]) {
      for (const scope of item.scopes) expect(declared.has(scope), `${scope} is not in auth.scopes`).toBe(true);
    }
    expect(declared.size).toBe(13);
  });

  it('gives every action a JSON Schema 2020-12 input with titles and descriptions the Hub can render forms from', () => {
    for (const action of manifest.actions) {
      const schema = action.inputSchema as { type?: string; properties?: Record<string, { title?: string }>; anyOf?: unknown[]; $schema?: string };
      expect(schema.$schema).toBeUndefined();
      if (schema.anyOf) {
        expect(schema.anyOf.length).toBeGreaterThan(1);
        continue;
      }
      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
    }
    const create = toJsonSchema(ACTIONS['projects.create'].input, 'input') as {
      properties: Record<string, { title?: string; description?: string; enum?: string[]; default?: unknown; minLength?: number; maxLength?: number }>;
      additionalProperties?: boolean;
      required?: string[];
    };
    expect(create.additionalProperties).toBe(false);
    expect(create.properties.name?.title).toBe('Name');
    expect(create.properties.name?.minLength).toBe(2);
    expect(create.properties.name?.maxLength).toBe(60);
    expect(create.properties.source?.default).toBe('git');
    expect(create.properties.source?.enum).toEqual(['git', 'image']);
    expect(create.properties.deploy?.default).toBe(true);
    expect(create.required).toEqual(expect.arrayContaining(['name', 'type']));
  });

  it('marks exactly projects.waitForDeployment as async', () => {
    expect(manifest.actions.filter((a) => a.async).map((a) => a.name)).toEqual(['projects.waitForDeployment']);
  });

  it('is JSON serialisable and round-trips', () => {
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

describe('OpenAPI', () => {
  it('describes every action and resource', () => {
    const doc = buildOpenApi({ baseUrl: 'https://orb.example.com' });
    expect(doc.openapi).toBe('3.1.0');
    for (const name of Object.keys(ACTIONS)) expect(doc.paths).toHaveProperty([`/actions/${name}`]);
    for (const resource of Object.values(RESOURCES)) expect(doc.paths).toHaveProperty([resource.path]);
    expect(doc.paths).toHaveProperty(['/webhooks/{id}/deliveries/{deliveryId}/redeliver']);
  });
});

describe('input validation', () => {
  it('rejects unknown fields (strict)', () => {
    const parsed = projectsCreateInput.safeParse({ name: 'App', type: 'static', repository: { fullName: 'a/b' }, nope: 1 });
    expect(parsed.success).toBe(false);
  });

  it('requires a repository for git projects and an image for image projects', () => {
    expect(projectsCreateInput.safeParse({ name: 'App', type: 'static' }).success).toBe(false);
    expect(projectsCreateInput.safeParse({ name: 'App', type: 'web_service', source: 'image' }).success).toBe(false);
    expect(projectsCreateInput.safeParse({ name: 'App', type: 'web_service', source: 'image', image: 'nginx:1.27' }).success).toBe(true);
    const ok = projectsCreateInput.safeParse({ name: 'App', type: 'static', repository: { fullName: 'acme/site' } });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.deploy).toBe(true);
  });

  it('rejects oversized metadata', () => {
    const big = { name: 'App', type: 'static', repository: { fullName: 'acme/site' }, metadata: { blob: 'x'.repeat(3000) } };
    expect(projectsCreateInput.safeParse(big).success).toBe(false);
  });
});

describe('scopes', () => {
  it('never grants write scopes to a viewer, and caps by role', () => {
    const all = parseScopeParam(manifest.auth.scopes.map((s) => s.name).join(' ')).scopes;
    expect(grantableScopes('viewer', all)).toEqual(['orb:orgs:read', 'orb:projects:read', 'orb:deployments:read', 'orb:domains:read', 'orb:logs:read', 'orb:analytics:read', 'orb:events:read']);
    const member = grantableScopes('member', all);
    expect(member).toContain('orb:projects:write');
    expect(member).toContain('orb:env:write');
    expect(member).not.toContain('orb:domains:write');
    expect(grantableScopes('admin', all)).toContain('orb:domains:write');
    expect(grantableScopes('owner', all)).toHaveLength(13);
  });

  it('adds events:read together with webhooks:manage', () => {
    expect(grantableScopes('member', ['orb:webhooks:manage'])).toEqual(['orb:events:read', 'orb:webhooks:manage']);
  });

  it('reports unknown scopes', () => {
    expect(parseScopeParam('orb:projects:read bogus:scope')).toEqual({ scopes: ['orb:projects:read'], unknown: ['bogus:scope'] });
  });
});

describe('event filters', () => {
  it('matches exact types, prefixes and *', () => {
    expect(eventMatchesFilter('deployment.ready', ['deployment.*'])).toBe(true);
    expect(eventMatchesFilter('deployment.ready', ['deployment.failed'])).toBe(false);
    expect(eventMatchesFilter('deployment.ready', ['*'])).toBe(true);
    expect(eventMatchesFilter('domain.added', ['deployment.*', 'project.created'])).toBe(false);
  });
  it('validates filters against the catalogue', () => {
    expect(isValidEventFilter('deployment.*')).toBe(true);
    expect(isValidEventFilter('deployment.ready')).toBe(true);
    expect(isValidEventFilter('nope.*')).toBe(false);
    expect(isValidEventFilter('deployment.exploded')).toBe(false);
  });
});
