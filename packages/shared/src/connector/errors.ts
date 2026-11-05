/**
 * CP1 error model. Every failure on `/api/connect/v1/*` is rendered as
 * `{ "error": { code, message, details?, retryable, requestId, ...extra } }`, never HTML.
 */
export const CONNECTOR_ERROR_STATUS = {
  unauthorized: 401,
  insufficient_scope: 403,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  idempotency_conflict: 422,
  plan_limit: 402,
  precondition_failed: 412,
  rate_limited: 429,
  upstream_failed: 502,
  unavailable: 503,
  internal: 500,
} as const;
export type ConnectorErrorCode = keyof typeof CONNECTOR_ERROR_STATUS;

export interface ConnectorErrorDetail {
  path: string;
  message: string;
}

export interface ConnectorErrorOptions {
  /** Overrides the default status of the code (e.g. 422 or 413 for `validation_failed`). */
  status?: number;
  details?: ConnectorErrorDetail[];
  /** Extra top-level fields of the error object: `requiredScope`, `limit`, `resetsAt`, `fixUrl`, ... */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
  cause?: unknown;
}

/** `retryable` is true only for 429/502/503 and 5xx. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status >= 500;
}

export class ConnectorError extends Error {
  readonly status: number;
  readonly details?: ConnectorErrorDetail[];
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
    options: ConnectorErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ConnectorError';
    this.status = options.status ?? CONNECTOR_ERROR_STATUS[code];
    this.details = options.details;
    this.extra = options.extra ?? {};
    this.headers = options.headers ?? {};
  }

  get retryable(): boolean {
    return isRetryableStatus(this.status);
  }

  toBody(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...this.extra,
        retryable: this.retryable,
        requestId,
      },
    };
  }
}

export const cpUnauthorized = (message = 'Missing, invalid, expired or revoked access token') =>
  new ConnectorError('unauthorized', message, { headers: { 'WWW-Authenticate': 'Bearer realm="orb-connector"' } });
export const cpInsufficientScope = (requiredScope: string) =>
  new ConnectorError('insufficient_scope', `This operation requires the ${requiredScope} scope`, { extra: { requiredScope } });
export const cpForbidden = (message = 'You do not have permission to do this') => new ConnectorError('forbidden', message);
export const cpNotFound = (what = 'Resource') => new ConnectorError('not_found', `${what} not found`);
export const cpConflict = (message: string, headers?: Record<string, string>) => new ConnectorError('conflict', message, { headers });
export const cpValidation = (message: string, details?: ConnectorErrorDetail[], status?: number) =>
  new ConnectorError('validation_failed', message, { details, status });
export const cpPlanLimit = (message: string, extra: { limit?: number; kind?: string; resetsAt?: string } = {}) =>
  new ConnectorError('plan_limit', message, { extra });
export const cpPrecondition = (message: string, extra: { code?: string; fixUrl?: string } = {}) =>
  new ConnectorError('precondition_failed', message, { extra });
export const cpRateLimited = (retryAfterSeconds: number) =>
  new ConnectorError('rate_limited', 'Too many requests', { headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) } });
export const cpUpstream = (message: string) => new ConnectorError('upstream_failed', message);
export const cpUnavailable = (message = 'Service temporarily unavailable') => new ConnectorError('unavailable', message);
export const cpInternal = (message = 'Internal error') => new ConnectorError('internal', message);
