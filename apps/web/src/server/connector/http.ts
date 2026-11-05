import { ZodError } from 'zod';
import { connectorEnabled, newRequestId, platformConfig } from 'core';
import {
  ConnectorError,
  cpForbidden,
  cpNotFound,
  cpUnauthorized,
  cpValidation,
  type ConnectorErrorCode,
  type ConnectorErrorDetail,
} from 'shared';
import { ApiError } from '../api';

/**
 * HTTP plumbing for `/api/connect/v1/*`: request ids, the uniform CP1 error shape, JSON-only responses, no CORS.
 * Everything answers 404 (in the CP1 error shape) while `CONNECTOR_ENABLED` is not `true`.
 */

/** A handler result with a custom status or headers. Plain values are sent as `200`. */
export class ConnectResponse {
  constructor(
    public readonly body: unknown,
    public readonly init: { status?: number; headers?: Record<string, string> } = {},
  ) {}
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Accepts the caller's `X-Request-Id` (when sane) or makes one up. */
export function requestIdOf(req: Request): string {
  const incoming = req.headers.get('x-request-id');
  return incoming && REQUEST_ID.test(incoming) ? incoming : newRequestId();
}

/** Where a user fixes things in the dashboard (e.g. linking GitHub). */
export const dashboardLink = (path = '/dashboard/settings') => `${platformConfig().dashboardUrl}${path}`;

const BY_LEGACY_CODE: Record<string, (e: ApiError) => ConnectorError> = {
  plan_limit: (e) => {
    const info = e as ApiError & { limit?: number; kind?: string };
    return new ConnectorError('plan_limit', e.message, { extra: { ...(info.limit !== undefined ? { limit: info.limit } : {}), ...(info.kind ? { kind: info.kind } : {}) } });
  },
  github_not_linked: (e) =>
    new ConnectorError('precondition_failed', e.message, { extra: { reason: 'github_not_connected', fixUrl: dashboardLink('/login') } }),
  github_token_invalid: (e) =>
    new ConnectorError('precondition_failed', e.message, { extra: { reason: 'github_token_invalid', fixUrl: dashboardLink('/login') } }),
  github_not_found: (e) => new ConnectorError('not_found', e.message),
  github_error: (e) => new ConnectorError('upstream_failed', e.message),
  queue_full: (e) => new ConnectorError('rate_limited', e.message, { headers: { 'Retry-After': '30' } }),
  payload_too_large: (e) => new ConnectorError('validation_failed', e.message, { status: 413 }),
  rate_limited: (e) => {
    const retryAfter = (e.details as { retryAfter?: number } | undefined)?.retryAfter ?? 1;
    return new ConnectorError('rate_limited', e.message, { headers: { 'Retry-After': String(Math.max(1, retryAfter)) } });
  },
};

const BY_STATUS: Record<number, ConnectorErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  402: 'plan_limit',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'precondition_failed',
  422: 'validation_failed',
  429: 'rate_limited',
  502: 'upstream_failed',
  503: 'unavailable',
};

function zodDetails(error: ZodError): ConnectorErrorDetail[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Services written for the dashboard throw `ApiError`; connector callers always get a CP1 error. */
export function toConnectorError(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;
  if (err instanceof ZodError) {
    const details = zodDetails(err);
    const first = details[0];
    return cpValidation(first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request', details);
  }
  if (err instanceof ApiError) {
    const byCode = BY_LEGACY_CODE[err.code];
    if (byCode) return byCode(err);
    if (err.status === 401) return cpUnauthorized(err.message);
    if (err.status === 403) return cpForbidden(err.message);
    if (err.status === 404) return cpNotFound(err.message.replace(/ not found$/i, ''));
    const code = BY_STATUS[err.status] ?? (err.status >= 500 ? 'internal' : 'validation_failed');
    return new ConnectorError(code, err.message, { status: code === 'validation_failed' && err.status === 413 ? 413 : undefined });
  }
  return new ConnectorError('internal', 'Internal error');
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } | undefined, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { ...BASE_HEADERS, 'x-request-id': requestId, ...init?.headers },
  });
}

export function errorResponse(error: ConnectorError, requestId: string): Response {
  return jsonResponse(error.toBody(requestId), { status: error.status, headers: error.headers }, requestId);
}

/** One structured log line per unexpected failure: never the request body, headers or tokens. */
function logUnexpected(err: unknown, requestId: string, req: Request): void {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'connector request failed',
      requestId,
      method: req.method,
      path: new URL(req.url).pathname,
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
}

export interface ConnectContext<P> {
  req: Request;
  params: P;
  requestId: string;
}

type RouteHandlerContext<P> = { params: Promise<P> };

/** The wrapper every connector route uses (public routes directly, authenticated ones through `connectAuthed`). */
export function connectRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: ConnectContext<P>) => Promise<unknown>,
) {
  return async (req: Request, routeCtx?: RouteHandlerContext<P>): Promise<Response> => {
    const requestId = requestIdOf(req);
    if (!connectorEnabled()) return errorResponse(cpNotFound('Route'), requestId);
    try {
      const params = (routeCtx ? await routeCtx.params : {}) as P;
      const result = await handler({ req, params, requestId });
      if (result instanceof Response) {
        result.headers.set('x-request-id', requestId);
        return result;
      }
      if (result instanceof ConnectResponse) return jsonResponse(result.body, result.init, requestId);
      return jsonResponse(result ?? { ok: true }, undefined, requestId);
    } catch (err) {
      const mapped = toConnectorError(err);
      if (mapped.code === 'internal') logUnexpected(err, requestId, req);
      return errorResponse(mapped, requestId);
    }
  };
}
