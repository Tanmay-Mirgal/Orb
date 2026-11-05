import { hmacSha256Hex, randomToken, safeEqual } from '../crypto';

/** Outbound webhook signing and the retry schedule (CP1 §5). */

export const WEBHOOK_SECRET_PREFIX = 'whsec_';

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomToken(32)}`;
}

/** `v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>` */
export function signWebhook(secret: string, timestamp: number | string, rawBody: string): string {
  return `v1=${hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;
}

/** What a consumer does: recompute and compare in constant time, and reject stale timestamps. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
  options: { toleranceSeconds?: number; nowMs?: number } = {},
): boolean {
  const tolerance = options.toleranceSeconds ?? 300;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > tolerance) return false;
  return signatureHeader.split(',').some((candidate) => safeEqual(candidate.trim(), signWebhook(secret, timestamp, rawBody)));
}

export interface WebhookHeaderInput {
  type: string;
  deliveryId: string;
  timestamp: number;
  signature: string;
  serviceName?: string;
}

export function webhookHeaders(input: WebhookHeaderInput): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': `${input.serviceName ?? 'Orb'}-Connector/1.0`,
    'X-CP-Event': input.type,
    'X-CP-Delivery': input.deliveryId,
    'X-CP-Timestamp': String(input.timestamp),
    'X-CP-Signature': input.signature,
  };
}

/** Back-off after attempt n fails: 10 s, 30 s, 2 m, 10 m, 30 m, 1 h, 3 h, 6 h (8 retries, about 11 hours in total). */
export const RETRY_DELAYS_SECONDS = [10, 30, 120, 600, 1800, 3600, 10_800, 21_600] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;
export const RETRY_JITTER = 0.2;

/**
 * Delay before the next attempt, or null when the delivery is exhausted. `failedAttempts` counts attempts made so far
 * (1 = the first delivery failed). ±20 % jitter keeps retries of many endpoints from arriving in lock-step.
 */
export function retryDelayMs(failedAttempts: number, random: () => number = Math.random): number | null {
  const base = RETRY_DELAYS_SECONDS[failedAttempts - 1];
  if (base === undefined) return null;
  const jitter = 1 + (random() * 2 - 1) * RETRY_JITTER;
  return Math.round(base * 1000 * jitter);
}

export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 50;
export const DISABLE_AFTER_FAILING_MS = 3 * 24 * 60 * 60 * 1000;
export const WEBHOOK_CONNECT_TIMEOUT_MS = 5_000;
export const WEBHOOK_TOTAL_TIMEOUT_MS = 10_000;
export const RESPONSE_EXCERPT_BYTES = 1024;
