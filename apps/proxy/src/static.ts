import type { IncomingMessage, ServerResponse } from 'node:http';
import { LRUCache } from 'lru-cache';
import { evaluateRoutes, headersForPath, type OrbConfig } from 'shared';
import { storageKeys, type ObjectStorage } from 'storage';
import type { ProxyConfig } from './config';
import { errorPage } from './pages';

interface SiteManifest {
  version: 1;
  files: Record<string, { size: number; type: string }>;
  config: OrbConfig | null;
}

interface CachedBody {
  buffer: Buffer;
  type: string;
  etag?: string;
}

const IMMUTABLE = /(^|\/)(_next\/static|assets|static)\/|[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

function cacheControl(path: string): string {
  return IMMUTABLE.test(path) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * Serves static deployments straight from object storage with:
 * manifest-based lookup (no storage round trips for 404s), clean URLs, SPA fallback, orb.json
 * redirects/rewrites/headers, ETag + conditional requests, Range support and an in-memory cache for small files.
 */
export class StaticHandler {
  private readonly manifests = new LRUCache<string, { value: SiteManifest | null }>({ max: 500, ttl: 10 * 60_000 });
  private readonly bodies: LRUCache<string, CachedBody>;

  constructor(
    private readonly storage: ObjectStorage,
    config: ProxyConfig,
  ) {
    this.bodies = new LRUCache<string, CachedBody>({
      maxSize: config.siteCacheMb * 1024 * 1024,
      sizeCalculation: (v) => v.buffer.length + 200,
    });
  }

  private async manifest(deploymentId: string): Promise<SiteManifest | null> {
    const hit = this.manifests.get(deploymentId);
    if (hit) return hit.value;
    const object = await this.storage.get(storageKeys.siteManifest(deploymentId));
    const manifest = object ? (JSON.parse((await readAll(object.body)).toString('utf8')) as SiteManifest) : null;
    // Do not cache misses for long: the artifact may still be uploading.
    this.manifests.set(deploymentId, { value: manifest }, { ttl: manifest ? 10 * 60_000 : 2000 });
    return manifest;
  }

  async handle(req: IncomingMessage, res: ServerResponse, deploymentId: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const manifest = await this.manifest(deploymentId);
    if (!manifest) return this.html(res, 503, 'Deployment unavailable', 'The files for this deployment are not available right now.');

    const url = new URL(req.url ?? '/', 'http://x');
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return this.html(res, 400, 'Bad request', 'Malformed URL.');
    }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) {
      return this.html(res, 400, 'Bad request', 'Invalid path.');
    }
    const config = manifest.config ?? undefined;

    const decision = evaluateRoutes(config, pathname);
    if (decision.type === 'redirect') {
      res.writeHead(decision.status, { Location: decision.location + (decision.location.includes('?') ? '' : url.search) }).end();
      return;
    }
    if (decision.type === 'rewrite') pathname = decision.path;

    if (config?.cleanUrls && pathname.endsWith('.html') && !pathname.endsWith('/index.html')) {
      res.writeHead(308, { Location: pathname.slice(0, -5) + url.search }).end();
      return;
    }

    const files = manifest.files;
    const rel = pathname.replace(/^\/+/, '');
    const candidates = pathname.endsWith('/') || rel === '' ? [`${rel}index.html`] : [rel, `${rel}.html`, `${rel}/index.html`];
    let key = candidates.find((c) => c in files);
    let status = 200;
    if (!key) {
      const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(rel);
      if (config?.spa && !hasExtension && 'index.html' in files) {
        key = 'index.html';
      } else if ('404.html' in files) {
        key = '404.html';
        status = 404;
      } else {
        return this.html(res, 404, 'Page not found', 'This page does not exist on this site.');
      }
    }
    await this.send(req, res, deploymentId, key, files[key]!, status, pathname, config);
  }

  private async send(
    req: IncomingMessage,
    res: ServerResponse,
    deploymentId: string,
    key: string,
    meta: { size: number; type: string },
    status: number,
    pathname: string,
    config: OrbConfig | undefined,
  ): Promise<void> {
    const headers: Record<string, string | number> = {
      'Content-Type': meta.type,
      'Cache-Control': status === 200 ? cacheControl(key) : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    for (const [name, value] of headersForPath(config, pathname)) headers[name] = value;

    const ifNoneMatch = req.headers['if-none-match'];
    const range = req.headers.range;
    const cacheKey = `${deploymentId}/${key}`;

    const cached = !range ? this.bodies.get(cacheKey) : undefined;
    if (cached) {
      headers.ETag = cached.etag ?? '';
      if (cached.etag && ifNoneMatch === cached.etag && status === 200) {
        res.writeHead(304, headers).end();
        return;
      }
      headers['Content-Length'] = cached.buffer.length;
      res.writeHead(status, headers).end(req.method === 'HEAD' ? undefined : cached.buffer);
      return;
    }

    const object = await this.storage.get(storageKeys.siteFile(deploymentId, key), {
      range: typeof range === 'string' ? range : undefined,
      ifNoneMatch: typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined,
    });
    if (!object) return this.html(res, 404, 'Page not found', 'This page does not exist on this site.');
    if (object.etag) headers.ETag = object.etag;
    headers['Accept-Ranges'] = 'bytes';

    if (object.notModified && status === 200) {
      res.writeHead(304, headers).end();
      return;
    }
    if (object.contentRange) {
      headers['Content-Range'] = object.contentRange;
      headers['Content-Length'] = object.size;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return void res.end();
      object.body.pipe(res);
      return;
    }
    headers['Content-Length'] = meta.size;
    if (req.method === 'HEAD') {
      object.body.destroy();
      res.writeHead(status, headers).end();
      return;
    }
    if (meta.size <= 256 * 1024) {
      const buffer = await readAll(object.body);
      this.bodies.set(cacheKey, { buffer, type: meta.type, etag: object.etag });
      res.writeHead(status, headers).end(buffer);
      return;
    }
    res.writeHead(status, headers);
    object.body.on('error', () => res.destroy());
    object.body.pipe(res);
  }

  private html(res: ServerResponse, status: number, title: string, message: string): void {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(errorPage(status, title, message));
  }
}
