import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { rateLimit } from 'core';
import { getRedis } from './infra';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Authentication required') => new ApiError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have permission to do this') => new ApiError(403, message, 'forbidden');
export const notFound = (what = 'Resource') => new ApiError(404, `${what} not found`, 'not_found');
export const conflict = (message: string) => new ApiError(409, message, 'conflict');
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, 'bad_request', details);
export const planLimit = (message: string) => new ApiError(402, message, 'plan_limit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(value: string, what = 'Resource'): void {
  if (!UUID.test(value)) throw notFound(what);
}

const MAX_BODY_BYTES = 1024 * 1024;

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'Request body too large', 'payload_too_large');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

function validationError(error: ZodError): ApiError {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  return badRequest(first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request', issues);
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim() || null;
  return req.headers.get('x-real-ip');
}

/** Rejects cross-site state-changing requests that carry cookies (defence in depth next to SameSite=Lax). */
export function assertSameOrigin(req: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host !== host) throw forbidden('Cross-origin request blocked');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw forbidden('Invalid Origin header');
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds = 60): Promise<void> {
  const result = await rateLimit(getRedis(), key, limit, windowSeconds);
  if (!result.allowed) {
    throw new ApiError(429, 'Too many requests, slow down', 'rate_limited', { retryAfter: result.resetSeconds });
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (error.status === 429 && error.details && typeof error.details === 'object' && 'retryAfter' in error.details) {
      headers['Retry-After'] = String((error.details as { retryAfter: number }).retryAfter);
    }
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status, headers });
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled API error', err: error instanceof Error ? error.stack : String(error) }));
  return NextResponse.json({ error: 'Internal server error', code: 'internal' }, { status: 500 });
}

type RouteContext<P> = { params: Promise<P> };

/** Wraps a handler: JSON serialisation of return values and uniform error responses. */
export function route<P extends Record<string, string> = Record<string, never>>(
  handler: (args: { req: Request; params: P }) => Promise<unknown>,
) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    try {
      const params = await ctx.params;
      const result = await handler({ req, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
