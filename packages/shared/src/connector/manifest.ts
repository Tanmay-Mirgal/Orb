import { z } from 'zod';
import { ACTIONS } from './actions';
import {
  CONNECTOR_BASE_PATH,
  CONNECTOR_DISPLAY_NAME,
  CONNECTOR_LIMITS,
  CONNECTOR_SERVICE,
  CONNECTOR_VERSION,
} from './common';
import { CONNECTOR_ERROR_STATUS } from './errors';
import { EVENTS, eventEnvelopeSchema } from './events';
import { RESOURCES } from './resources';
import { SCOPE_DEFINITIONS } from './scopes';
import { deliveryEntitySchema, eventsQuerySchema, webhookCreateSchema, webhookCreatedSchema, webhookEntitySchema, webhookPatchSchema } from './webhooks';

export type JsonSchema = Record<string, unknown>;

const cache = new WeakMap<object, Record<'input' | 'output', JsonSchema | undefined>>();

/** JSON Schema 2020-12 of a registry schema (cached; the registry is static). */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): JsonSchema {
  let entry = cache.get(schema);
  if (!entry) {
    entry = { input: undefined, output: undefined };
    cache.set(schema, entry);
  }
  if (!entry[io]) {
    const generated = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' }) as JsonSchema;
    delete generated.$schema;
    entry[io] = generated;
  }
  return entry[io]!;
}

export interface ManifestOptions {
  /** Public origin of the Orb dashboard, e.g. https://orb.example.com */
  baseUrl: string;
  docsUrl?: string;
}

export function buildManifest(options: ManifestOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const api = `${base}${CONNECTOR_BASE_PATH}`;
  return {
    protocol: 'cp1' as const,
    service: CONNECTOR_SERVICE,
    displayName: CONNECTOR_DISPLAY_NAME,
    version: CONNECTOR_VERSION,
    baseUrl: base,
    auth: {
      type: 'oauth2_code_pkce' as const,
      authorizeUrl: `${base}/connect/authorize`,
      tokenUrl: `${api}/oauth/token`,
      revokeUrl: `${api}/oauth/revoke`,
      scopes: SCOPE_DEFINITIONS.map((s) => ({ name: s.name, description: s.description })),
    },
    tenantKind: 'organization' as const,
    actions: Object.values(ACTIONS).map((a) => ({
      name: a.name,
      description: a.description,
      scopes: [...a.scopes],
      async: a.async,
      idempotent: a.idempotent,
      inputSchema: toJsonSchema(a.input, 'input'),
      outputSchema: toJsonSchema(a.output, 'output'),
    })),
    resources: Object.values(RESOURCES).map((r) => ({
      name: r.name,
      method: r.method,
      path: r.path,
      scopes: [...r.scopes],
      description: r.description,
      querySchema: toJsonSchema(r.query, 'input'),
      outputSchema: toJsonSchema(r.output, 'output'),
    })),
    events: EVENTS.map((e) => ({
      type: e.type,
      description: e.description,
      scopes: [...e.scopes],
      dataSchema: toJsonSchema(e.data, 'output'),
    })),
    limits: { ...CONNECTOR_LIMITS },
    links: {
      docs: options.docsUrl ?? `${base}${CONNECTOR_BASE_PATH}/manifest`,
      openapi: `${CONNECTOR_BASE_PATH}/openapi.json`,
    },
  };
}
export type ConnectorManifest = ReturnType<typeof buildManifest>;

const errorSchema: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'retryable', 'requestId'],
      properties: {
        code: { type: 'string', enum: Object.keys(CONNECTOR_ERROR_STATUS) },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
        retryable: { type: 'boolean' },
        requestId: { type: 'string' },
        requiredScope: { type: 'string' },
        limit: { type: 'number' },
        resetsAt: { type: 'string', format: 'date-time' },
        fixUrl: { type: 'string' },
      },
    },
  },
};

const errorResponses = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [code, status] of Object.entries(CONNECTOR_ERROR_STATUS)) {
    out[String(status)] ??= { description: code, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  }
  return out;
};

function queryParameters(schema: JsonSchema): unknown[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, s]) => ({ name, in: 'query', required: required.has(name), schema: s }));
}

const bearer = [{ bearerAuth: [] }];
const jsonBody = (schema: JsonSchema) => ({ required: true, content: { 'application/json': { schema } } });
const jsonResponse = (description: string, schema: JsonSchema) => ({ description, content: { 'application/json': { schema } } });

/** OpenAPI 3.1 document generated from the same registry as the manifest. */
export function buildOpenApi(options: ManifestOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const paths: Record<string, unknown> = {};

  paths['/health'] = {
    get: {
      operationId: 'health',
      summary: 'Liveness',
      security: [],
      responses: { '200': jsonResponse('OK', { type: 'object', properties: { status: { const: 'ok' }, version: { type: 'string' }, time: { type: 'string', format: 'date-time' } } }) },
    },
  };
  paths['/manifest'] = { get: { operationId: 'manifest', summary: 'Connector manifest', security: [], responses: { '200': jsonResponse('Manifest', { type: 'object' }) } } };
  paths['/openapi.json'] = { get: { operationId: 'openapi', summary: 'This document', security: [], responses: { '200': jsonResponse('OpenAPI 3.1', { type: 'object' }) } } };
  paths['/me'] = { get: { operationId: 'me', summary: 'The connection: user, tenant, scopes, plan and capabilities', security: bearer, responses: { '200': jsonResponse('Connection', { type: 'object' }), ...errorResponses() } } };
  paths['/oauth/token'] = {
    post: {
      operationId: 'oauthToken',
      summary: 'Exchange an authorization code or refresh a token',
      security: [],
      requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } }, 'application/json': { schema: { type: 'object' } } } },
      responses: { '200': jsonResponse('Token response', { type: 'object' }), '400': jsonResponse('RFC 6749 error', { type: 'object' }) },
    },
  };
  paths['/oauth/revoke'] = { post: { operationId: 'oauthRevoke', summary: 'Revoke a token (RFC 7009)', security: [], responses: { '200': { description: 'Always 200' } } } };

  for (const action of Object.values(ACTIONS)) {
    paths[`/actions/${action.name}`] = {
      post: {
        operationId: `action_${action.name.replace(/\./g, '_')}`,
        summary: action.description,
        tags: ['actions'],
        security: bearer,
        'x-required-scopes': [...action.scopes],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 128 } }],
        requestBody: jsonBody({ type: 'object', required: ['input'], additionalProperties: false, properties: { input: toJsonSchema(action.input, 'input') } }),
        responses: {
          [action.async ? '202' : '200']: jsonResponse(
            action.async ? 'Accepted: poll the operation' : 'Done',
            action.async
              ? { type: 'object', properties: { operation: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, pollUrl: { type: 'string' } } } } }
              : { type: 'object', properties: { output: toJsonSchema(action.output, 'output') } },
          ),
          ...errorResponses(),
        },
      },
    };
  }

  for (const resource of Object.values(RESOURCES)) {
    const params = resource.path.match(/\{(\w+)\}/g)?.map((p) => ({ name: p.slice(1, -1), in: 'path', required: true, schema: { type: 'string' } })) ?? [];
    paths[resource.path] = {
      get: {
        operationId: `resource_${resource.name.replace(/\./g, '_')}`,
        summary: resource.description,
        tags: ['resources'],
        security: bearer,
        'x-required-scopes': [...resource.scopes],
        parameters: [...params, ...queryParameters(toJsonSchema(resource.query, 'input'))],
        responses: { '200': jsonResponse('OK', toJsonSchema(resource.output, 'output')), ...errorResponses() },
      },
    };
  }

  paths['/operations/{id}'] = {
    get: {
      operationId: 'operation',
      summary: 'Status of a long-running action',
      security: bearer,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonResponse('Operation', { type: 'object' }), ...errorResponses() },
    },
  };
  paths['/webhooks'] = {
    get: { operationId: 'webhooksList', summary: 'Webhook endpoints of this connection', tags: ['webhooks'], security: bearer, responses: { '200': jsonResponse('OK', { type: 'object', properties: { items: { type: 'array', items: toJsonSchema(webhookEntitySchema, 'output') }, nextCursor: { type: ['string', 'null'] } } }) } },
    post: { operationId: 'webhooksCreate', summary: 'Register an endpoint; the secret is returned once', tags: ['webhooks'], security: bearer, requestBody: jsonBody(toJsonSchema(webhookCreateSchema, 'input')), responses: { '201': jsonResponse('Created', toJsonSchema(webhookCreatedSchema, 'output')), ...errorResponses() } },
  };
  paths['/webhooks/{id}'] = {
    get: { operationId: 'webhooksGet', tags: ['webhooks'], security: bearer, responses: { '200': jsonResponse('OK', toJsonSchema(webhookEntitySchema, 'output')) } },
    patch: { operationId: 'webhooksPatch', tags: ['webhooks'], security: bearer, requestBody: jsonBody(toJsonSchema(webhookPatchSchema, 'input')), responses: { '200': jsonResponse('OK', toJsonSchema(webhookEntitySchema, 'output')) } },
    delete: { operationId: 'webhooksDelete', tags: ['webhooks'], security: bearer, responses: { '200': { description: 'Deleted' } } },
  };
  paths['/webhooks/{id}/deliveries'] = {
    get: { operationId: 'webhooksDeliveries', tags: ['webhooks'], security: bearer, responses: { '200': jsonResponse('OK', { type: 'object', properties: { items: { type: 'array', items: toJsonSchema(deliveryEntitySchema, 'output') }, nextCursor: { type: ['string', 'null'] } } }) } },
  };
  paths['/webhooks/{id}/deliveries/{deliveryId}/redeliver'] = {
    post: { operationId: 'webhooksRedeliver', tags: ['webhooks'], security: bearer, responses: { '202': { description: 'Queued' } } },
  };
  paths['/events'] = {
    get: {
      operationId: 'events',
      summary: "The team's event log (polling fallback)",
      tags: ['events'],
      security: bearer,
      parameters: queryParameters(toJsonSchema(eventsQuerySchema, 'input')),
      responses: { '200': jsonResponse('OK', { type: 'object', properties: { items: { type: 'array', items: toJsonSchema(eventEnvelopeSchema, 'output') }, nextCursor: { type: ['string', 'null'] } } }) },
    },
  };

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: `${CONNECTOR_DISPLAY_NAME} ecosystem connector (CP1)`,
      version: CONNECTOR_VERSION,
      description: 'Connector Protocol v1: OAuth 2.0 authorization code + PKCE, scoped actions and resources, signed webhooks.',
    },
    servers: [{ url: `${base}${CONNECTOR_BASE_PATH}` }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'cp1_orb_… access token from the OAuth flow' },
      },
      schemas: {
        Error: errorSchema,
        EventEnvelope: toJsonSchema(eventEnvelopeSchema, 'output'),
      },
    },
    security: bearer,
    'x-events': EVENTS.map((e) => ({ type: e.type, scopes: [...e.scopes], dataSchema: toJsonSchema(e.data, 'output') })),
  };
}
