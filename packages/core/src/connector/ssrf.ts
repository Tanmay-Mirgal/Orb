import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { BlockList, isIP } from 'node:net';
import {
  RESPONSE_EXCERPT_BYTES,
  WEBHOOK_CONNECT_TIMEOUT_MS,
  WEBHOOK_TOTAL_TIMEOUT_MS,
} from './webhook';

/**
 * SSRF protection for webhook delivery: the connector makes outbound requests to a caller-supplied URL, so it must
 * never reach loopback, link-local (incl. cloud metadata), private (RFC 1918 / 4193), CGNAT or reserved addresses.
 * The check runs at registration AND at delivery time, on the address the socket really connects to (no DNS-rebinding
 * window), and redirects are never followed.
 */

const blocked = new BlockList();
const v4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, 'ipv4');
const v6: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];
for (const [net, prefix] of v6) blocked.addSubnet(net, prefix, 'ipv6');

/** IPv4 inside an IPv6 literal (`::ffff:a.b.c.d`, `::ffff:7f00:1`, NAT64 `64:ff9b::a.b.c.d`), if any. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(address);
  if (family === 0) return true; // not an IP literal: refuse rather than guess
  const inner = family === 6 ? embeddedIpv4(address) : null;
  if (inner) return blocked.check(inner, 'ipv4');
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

export interface WebhookUrlPolicy {
  /** https is required in production. */
  production: boolean;
  /** Development escape hatch (`CONNECTOR_ALLOW_PRIVATE_WEBHOOKS`): allows http and private addresses. */
  allowPrivate: boolean;
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

/** Static checks on the URL itself (no DNS). */
export function parseWebhookUrl(raw: string, policy: WebhookUrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('The webhook URL is not a valid URL');
  }
  if (url.username || url.password) throw new WebhookUrlError('The webhook URL must not contain credentials');
  if (url.hash) throw new WebhookUrlError('The webhook URL must not contain a fragment');
  const secureRequired = policy.production || !policy.allowPrivate;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !secureRequired)) {
    throw new WebhookUrlError('The webhook URL must use https');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!policy.allowPrivate) {
    if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)) || (!host.includes('.') && isIP(host) === 0)) {
      throw new WebhookUrlError('The webhook URL must point at a public host');
    }
    if (isIP(host) !== 0 && isBlockedAddress(host)) throw new WebhookUrlError('The webhook URL points at a private or reserved address');
  }
  return url;
}

type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

/** Registration-time check: URL shape plus every address the name resolves to. */
export async function assertPublicWebhookUrl(raw: string, policy: WebhookUrlPolicy, resolve: Resolver = systemResolver): Promise<URL> {
  const url = parseWebhookUrl(raw, policy);
  if (policy.allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return url; // already vetted by parseWebhookUrl
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new WebhookUrlError('The webhook host does not resolve');
  }
  if (addresses.length === 0) throw new WebhookUrlError('The webhook host does not resolve');
  if (addresses.some(isBlockedAddress)) throw new WebhookUrlError('The webhook host resolves to a private or reserved address');
  return url;
}

/** `lookup` for http(s).request: resolves and vets the address the socket is going to use. */
export function guardedLookup(policy: WebhookUrlPolicy): typeof dns.lookup {
  const lookup = ((hostname: string, options: dns.LookupOptions | number | undefined, callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) => {
    const opts: dns.LookupOptions = typeof options === 'object' && options !== null ? options : {};
    dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, records) => {
      if (err) return callback(err);
      const list = records as dns.LookupAddress[];
      if (!policy.allowPrivate) {
        const bad = list.find((r) => isBlockedAddress(r.address));
        if (bad) return callback(Object.assign(new Error('Blocked address'), { code: 'EBLOCKED' }) as NodeJS.ErrnoException);
      }
      if (opts.all) return callback(null, list);
      const first = list[0];
      if (!first) return callback(Object.assign(new Error('No address'), { code: 'ENOTFOUND' }) as NodeJS.ErrnoException);
      return callback(null, first.address, first.family);
    });
  }) as unknown as typeof dns.lookup;
  return lookup;
}

export interface WebhookResponse {
  status: number;
  excerpt: string;
}

export interface PostWebhookOptions {
  url: URL;
  body: string;
  headers: Record<string, string>;
  policy: WebhookUrlPolicy;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/**
 * POST without following redirects: 5 s to connect, 10 s overall. Resolves with the status for ANY HTTP response
 * (the caller decides what is a success) and rejects on network errors, timeouts and blocked addresses.
 */
export function postWebhook(options: PostWebhookOptions): Promise<WebhookResponse> {
  const { url, body, headers, policy } = options;
  const connectTimeout = options.connectTimeoutMs ?? WEBHOOK_CONNECT_TIMEOUT_MS;
  const totalTimeout = options.totalTimeoutMs ?? WEBHOOK_TOTAL_TIMEOUT_MS;
  const transport = url.protocol === 'https:' ? https : http;

  // Node skips `lookup` for IP literals, so they are vetted here (the guarded lookup covers host names).
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (!policy.allowPrivate && isIP(literal) !== 0 && isBlockedAddress(literal)) {
    return Promise.reject(new WebhookUrlError('The webhook URL points at a private or reserved address'));
  }

  return new Promise<WebhookResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      fn();
    };
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: guardedLookup(policy) as never,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size < RESPONSE_EXCERPT_BYTES) {
            chunks.push(chunk);
            size += chunk.length;
          }
        });
        res.on('end', () =>
          finish(() => resolve({ status: res.statusCode ?? 0, excerpt: Buffer.concat(chunks).subarray(0, RESPONSE_EXCERPT_BYTES).toString('utf8') })),
        );
        res.on('error', (err) => finish(() => reject(err)));
      },
    );
    const connectTimer = setTimeout(() => {
      req.destroy(new Error(`Connection timed out after ${connectTimeout} ms`));
    }, connectTimeout);
    const totalTimer = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${totalTimeout} ms`));
    }, totalTimeout);
    req.on('socket', (socket) => {
      const connected = () => clearTimeout(connectTimer);
      if (!socket.connecting) connected();
      else socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
    });
    req.on('error', (err) => finish(() => reject(err)));
    req.end(body);
  });
}
