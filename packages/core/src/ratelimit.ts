import type { Redis } from 'ioredis';
import { REDIS_KEYS } from 'shared';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

/**
 * Fixed-window counter shared by every web/proxy instance through Redis.
 * Fails open: an unavailable Redis must not take the API down.
 */
export async function rateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const redisKey = REDIS_KEYS.rateLimit(`${key}:${windowId}`);
  try {
    const results = await redis.multi().incr(redisKey).expire(redisKey, windowSeconds + 1, 'NX').exec();
    const count = Number(results?.[0]?.[1] ?? 1);
    const resetSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit, resetSeconds };
  } catch {
    return { allowed: true, remaining: limit, limit, resetSeconds: windowSeconds };
  }
}
