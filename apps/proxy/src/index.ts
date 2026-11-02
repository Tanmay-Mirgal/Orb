import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';
import { createLogger, createMetrics, createRedis, loadEnv, startOpsServer, subscribeRouteInvalidation } from 'core';
import { createDb, sql } from 'database';
import { createStorageFromEnv } from 'storage';
import { proxyConfig } from './config';
import { EdgeMetrics } from './edge-metrics';
import { errorPage } from './pages';
import { RouteResolver, type Endpoint, type Route } from './routes';
import { StaticHandler } from './static';

loadEnv();

async function main() {
  const config = proxyConfig();
  const logger = createLogger('proxy');
  const { db, sql: pg } = createDb(undefined, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  const redis = createRedis('proxy');
  const subscriber = createRedis('proxy-sub');
  const storage = createStorageFromEnv();
  await storage.ensureReady();

  const resolver = new RouteResolver(db, config);
  await subscribeRouteInvalidation(subscriber, (message) => resolver.invalidate(message));
  const statics = new StaticHandler(storage, config);
  const edge = new EdgeMetrics(redis);
  edge.start();

  const metrics = createMetrics('proxy');
  const requestsTotal = new metrics.client.Counter({ name: 'orb_proxy_requests_total', help: 'Edge requests', labelNames: ['kind', 'status'], registers: [metrics.registry] });
  const latency = new metrics.client.Histogram({ name: 'orb_proxy_request_seconds', help: 'Edge request latency', labelNames: ['kind'], buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 30], registers: [metrics.registry] });

  const proxy = httpProxy.createProxyServer({ xfwd: false, changeOrigin: false, proxyTimeout: config.upstreamTimeoutMs, timeout: 0 });
  const unhealthy = new Map<string, number>(); // "address:port" -> retry-after timestamp (passive health check)
  const counters = new Map<string, number>(); // route round-robin
  const hits = new Map<string, { n: number; windowStart: number }>(); // per-IP rate limiting
  setInterval(() => {
    const cutoff = Date.now() - 5000;
    for (const [ip, h] of hits) if (h.windowStart < cutoff) hits.delete(ip);
    for (const [k, until] of unhealthy) if (until < Date.now()) unhealthy.delete(k);
  }, 10_000).unref();

  const html = (res: http.ServerResponse, status: number, title: string, message: string) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(errorPage(status, title, message));
  };

  const clientIp = (req: http.IncomingMessage): string => {
    const forwarded = config.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || 'unknown';
  };

  const limited = (ip: string): boolean => {
    if (config.ratePerIp <= 0) return false;
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.windowStart >= 1000) {
      hits.set(ip, { n: 1, windowStart: now });
      return false;
    }
    return ++h.n > config.ratePerIp;
  };

  const pick = (route: Extract<Route, { kind: 'service' }>, skip: Set<string>): Endpoint | null => {
    const now = Date.now();
    const usable = route.endpoints.filter((e) => !skip.has(e.id) && (unhealthy.get(`${e.address}:${e.port}`) ?? 0) < now);
    const pool = usable.length > 0 ? usable : route.endpoints.filter((e) => !skip.has(e.id));
    if (pool.length === 0) return null;
    const next = (counters.get(route.deploymentId) ?? 0) + 1;
    counters.set(route.deploymentId, next);
    return pool[next % pool.length]!;
  };

  const sanitize = (req: http.IncomingMessage, id: string) => {
    for (const name of Object.keys(req.headers)) if (name.startsWith('x-orb-')) delete req.headers[name];
    req.headers['x-request-id'] = (req.headers['x-request-id'] as string | undefined) ?? id;
  };

  const forward = (req: http.IncomingMessage, res: http.ServerResponse, route: Extract<Route, { kind: 'service' }>, tried: Set<string>) => {
    const endpoint = pick(route, tried);
    if (!endpoint) return html(res, 502, 'Bad gateway', 'The application did not respond.');
    tried.add(endpoint.id);
    proxy.web(req, res, { target: `http://${endpoint.address}:${endpoint.port}` }, (err) => {
      unhealthy.set(`${endpoint.address}:${endpoint.port}`, Date.now() + 10_000);
      const idempotent = req.method === 'GET' || req.method === 'HEAD';
      if (idempotent && !res.headersSent && tried.size < route.endpoints.length) return forward(req, res, route, tried);
      logger.warn({ endpoint: endpoint.id, err: err.message }, 'upstream error');
      const timeout = /timeout|ETIMEDOUT/i.test(err.message);
      html(res, timeout ? 504 : 502, timeout ? 'Gateway timeout' : 'Bad gateway', 'The application did not respond in time.');
    });
  };

  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint();
    const startBytes = req.socket.bytesWritten;
    const requestId = randomUUID();
    let kind = 'none';
    let projectId: string | undefined;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Server', 'orb');
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      requestsTotal.inc({ kind, status: String(res.statusCode) });
      latency.observe({ kind }, seconds);
      if (projectId) edge.record(projectId, res.statusCode, Math.max(0, req.socket.bytesWritten - startBytes), Math.round(seconds * 1000));
    });

    try {
      if (req.url === '/__orb/health') return void res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      if (limited(clientIp(req))) return void res.writeHead(429, { 'Retry-After': '1' }).end('Too Many Requests');

      const route = await resolver.resolve(req.headers.host);
      kind = route.kind;
      if (route.kind === 'redirect') {
        return void res.writeHead(route.status, { Location: route.location + (req.url ?? '/') }).end();
      }
      if (route.kind === 'none') {
        const [status, title, message] =
          route.reason === 'not_found'
            ? [404, 'Site not found', 'There is no project connected to this address.']
            : route.reason === 'no_deployment'
              ? [404, 'No deployment yet', 'This project has not been deployed yet.']
              : [503, 'Service starting', 'The application has no healthy instances right now. Please retry in a moment.'];
        return html(res, status as number, title as string, message as string);
      }
      projectId = route.projectId;
      sanitize(req, requestId);
      if (route.kind === 'static') return await statics.handle(req, res, route.deploymentId);
      forward(req, res, route, new Set());
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), url: req.url }, 'edge error');
      html(res, 500, 'Something went wrong', 'The edge could not process this request.');
    }
  });

  // WebSocket upgrades (HMR, sockets, SSE-over-WS) for services.
  server.on('upgrade', async (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const route = await resolver.resolve(req.headers.host);
      if (route.kind !== 'service') return void socket.destroy();
      const endpoint = pick(route, new Set());
      if (!endpoint) return void socket.destroy();
      sanitize(req, randomUUID());
      proxy.ws(req, socket, head, { target: `http://${endpoint.address}:${endpoint.port}` }, () => socket.destroy());
    } catch {
      socket.destroy();
    }
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  logger.info({ port: config.port, baseDomain: config.baseDomain }, 'Orb edge proxy listening');

  const ops = startOpsServer({
    port: config.opsPort,
    metrics,
    logger,
    checks: {
      redis: async () => {
        await redis.ping();
      },
      postgres: async () => {
        await db.execute(sql`select 1`);
      },
      storage: () => storage.ping(),
    },
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'draining connections');
    ops.close();
    server.close();
    await edge.stop();
    setTimeout(() => process.exit(0), 10_000).unref();
    await pg.end({ timeout: 5 });
    redis.disconnect();
    subscriber.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'proxy failed to start', err: err instanceof Error ? err.stack : String(err) }));
  process.exit(1);
});
