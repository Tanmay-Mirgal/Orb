import { env, envInt, platformConfig } from 'core';

export function proxyConfig() {
  return {
    ...platformConfig(),
    port: envInt('PROXY_PORT', envInt('PORT', 8000)),
    opsPort: envInt('PROXY_OPS_PORT', 9100),
    routeTtlMs: envInt('ROUTE_CACHE_TTL_SECONDS', 30) * 1000,
    negativeTtlMs: envInt('ROUTE_NEGATIVE_TTL_SECONDS', 5) * 1000,
    /** Requests per second per client IP before the edge answers 429. 0 disables. */
    ratePerIp: envInt('EDGE_RATE_LIMIT_RPS', 200),
    upstreamTimeoutMs: envInt('UPSTREAM_TIMEOUT_SECONDS', 60) * 1000,
    siteCacheMb: envInt('EDGE_SITE_CACHE_MB', 64),
    trustProxy: env('TRUST_PROXY') !== 'false',
  };
}

export type ProxyConfig = ReturnType<typeof proxyConfig>;
