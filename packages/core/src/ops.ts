import * as http from 'node:http';
import client from 'prom-client';
import type { Logger } from 'pino';

export interface Metrics {
  registry: client.Registry;
  client: typeof client;
}

export function createMetrics(service: string): Metrics {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry, prefix: 'orb_' });
  return { registry, client };
}

export type HealthCheck = () => Promise<void>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Tiny operations endpoint every backend service exposes on its own port:
 *   /healthz  liveness  (process is up)
 *   /readyz   readiness (dependencies reachable) -> use for load-balancer / orchestrator probes
 *   /metrics  Prometheus exposition
 * Keep this port private; it is not meant for the public internet.
 */
export function startOpsServer(options: {
  port: number;
  host?: string;
  metrics: Metrics;
  checks?: Record<string, HealthCheck>;
  logger?: Logger;
}): http.Server {
  const { port, host = '0.0.0.0', metrics, checks = {}, logger } = options;
  const server = http.createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    try {
      if (url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      } else if (url === '/readyz') {
        const results: Record<string, string> = {};
        let ok = true;
        await Promise.all(
          Object.entries(checks).map(async ([name, check]) => {
            try {
              await withTimeout(check(), 2000);
              results[name] = 'ok';
            } catch (e) {
              ok = false;
              results[name] = (e as Error).message;
            }
          }),
        );
        res
          .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: ok ? 'ready' : 'unavailable', checks: results }));
      } else if (url === '/metrics') {
        res
          .writeHead(200, { 'content-type': metrics.registry.contentType })
          .end(await metrics.registry.metrics());
      } else {
        res.writeHead(404).end();
      }
    } catch (e) {
      logger?.error({ err: e }, 'ops server error');
      res.writeHead(500).end();
    }
  });
  server.listen(port, host, () => logger?.info({ port }, 'ops server listening'));
  return server;
}
