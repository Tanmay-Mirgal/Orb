import type { Redis } from 'ioredis';
import { REDIS_KEYS, type RouteInvalidation } from 'shared';

export async function publishRouteInvalidation(redis: Redis, message: RouteInvalidation): Promise<void> {
  await redis.publish(REDIS_KEYS.routeInvalidate, JSON.stringify(message));
}

/** `subscriber` must be a dedicated connection (a subscribed client cannot issue other commands). */
export async function subscribeRouteInvalidation(
  subscriber: Redis,
  handler: (message: RouteInvalidation) => void,
): Promise<void> {
  await subscriber.subscribe(REDIS_KEYS.routeInvalidate);
  subscriber.on('message', (channel, raw) => {
    if (channel !== REDIS_KEYS.routeInvalidate) return;
    try {
      handler(JSON.parse(raw) as RouteInvalidation);
    } catch {
      handler({ all: true });
    }
  });
}
