import { Resolver } from 'node:dns/promises';
import { env } from './config';

/**
 * Custom-domain verification, modelled after Vercel/Netlify:
 *  1. OWNERSHIP  — a TXT record at `_orb-challenge.<domain>` containing `orb-verification=<token>`.
 *     This proves control of the DNS zone and prevents "dangling CNAME" subdomain takeovers.
 *  2. ROUTING    — a CNAME to the platform target (subdomains) or A records to the platform IPs (apex).
 * We query public recursive resolvers directly so a stale local cache never reports a false negative.
 */

export const CHALLENGE_PREFIX = '_orb-challenge';

export function challengeHost(domain: string): string {
  return `${CHALLENGE_PREFIX}.${domain}`;
}

export function challengeValue(token: string): string {
  return `orb-verification=${token}`;
}

function resolver(): Resolver {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  const servers = (env('DNS_RESOLVERS') ?? '1.1.1.1,8.8.8.8').split(',').map((s) => s.trim()).filter(Boolean);
  r.setServers(servers);
  return r;
}

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NXDOMAIN' || code === 'ENOENT';
}

export interface DnsCheck {
  ok: boolean;
  detail: string;
}

export async function verifyOwnership(domain: string, token: string): Promise<DnsCheck> {
  const expected = challengeValue(token);
  try {
    const records = (await resolver().resolveTxt(challengeHost(domain))).map((chunks) => chunks.join(''));
    if (records.includes(expected)) return { ok: true, detail: 'TXT record found' };
    return {
      ok: false,
      detail: records.length
        ? `TXT record at ${challengeHost(domain)} does not match (found ${records.length} other record(s))`
        : `No TXT record at ${challengeHost(domain)}`,
    };
  } catch (err) {
    if (isNotFound(err)) return { ok: false, detail: `No TXT record at ${challengeHost(domain)}` };
    return { ok: false, detail: `DNS lookup failed: ${(err as Error).message}` };
  }
}

export interface RoutingExpectation {
  cnameTarget: string;
  platformIps: string[];
}

/** Follows CNAME chains (max 5 hops) and falls back to comparing A records with the platform IPs. */
export async function checkRouting(domain: string, expect: RoutingExpectation): Promise<DnsCheck & { kind: 'cname' | 'a' | 'none' }> {
  const r = resolver();
  const target = expect.cnameTarget.toLowerCase().replace(/\.$/, '');
  const altTarget = target.replace(/^cname\./, '');
  let current = domain;
  try {
    for (let hop = 0; hop < 5; hop++) {
      let cnames: string[];
      try {
        cnames = await r.resolveCname(current);
      } catch (err) {
        if (isNotFound(err)) break;
        throw err;
      }
      const next = cnames[0]?.toLowerCase().replace(/\.$/, '');
      if (!next) break;
      if (next === target || next === altTarget) return { ok: true, kind: 'cname', detail: `CNAME → ${next}` };
      current = next;
    }

    const addresses = await r.resolve4(domain).catch((err) => {
      if (isNotFound(err)) return [] as string[];
      throw err;
    });
    if (addresses.length === 0) {
      return { ok: false, kind: 'none', detail: `No CNAME or A record found for ${domain}` };
    }

    const validIps = new Set(expect.platformIps);
    if (validIps.size === 0) {
      const targetIps = await r.resolve4(target).catch(() => [] as string[]);
      const altIps = await r.resolve4(altTarget).catch(() => [] as string[]);
      for (const ip of [...targetIps, ...altIps]) validIps.add(ip);
    }

    if (validIps.size > 0 && addresses.some((ip) => validIps.has(ip))) {
      return { ok: true, kind: 'a', detail: `A record → ${addresses.join(', ')}` };
    }
    return {
      ok: false,
      kind: 'a',
      detail:
        expect.platformIps.length > 0
          ? `A record points to ${addresses.join(', ')}; expected ${expect.platformIps.join(', ')}`
          : `Domain resolves to ${addresses.join(', ')} but does not CNAME to ${target}`,
    };
  } catch (err) {
    return { ok: false, kind: 'none', detail: `DNS lookup failed: ${(err as Error).message}` };
  }
}
