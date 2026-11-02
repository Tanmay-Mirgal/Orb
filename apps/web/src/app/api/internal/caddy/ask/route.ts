import { platformConfig } from 'core';
import { and, deployments, domains, eq, isNotNull, projects } from 'database';
import { isValidDnsLabel, normalizeDomain } from 'shared';
import { db } from '@/lib/db';
import { enforceRateLimit } from '@/server/api';

export const dynamic = 'force-dynamic';

/**
 * Caddy "on-demand TLS" authorisation endpoint (`on_demand_tls { ask ... }`).
 * A certificate is only ever issued for hostnames that really belong to the platform:
 *   - the dashboard host,
 *   - `<project-slug>.<base-domain>` and `<deployment-subdomain>.<base-domain>`,
 *   - custom domains whose ownership was proven via the DNS TXT challenge.
 * Anything else answers 404 so nobody can burn the platform's Let's Encrypt rate limits.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requested = url.searchParams.get('domain');
  if (!requested) return new Response('missing domain', { status: 400 });

  try {
    await enforceRateLimit('caddy-ask', 300, 60);
  } catch {
    return new Response('rate limited', { status: 429 });
  }

  const host = normalizeDomain(requested);
  const { baseDomain, dashboardUrl } = platformConfig();

  try {
    if (host === new URL(dashboardUrl).hostname.toLowerCase() || host === baseDomain) {
      return new Response('ok');
    }

    if (host.endsWith(`.${baseDomain}`)) {
      const label = host.slice(0, -(baseDomain.length + 1));
      if (!isValidDnsLabel(label)) return new Response('invalid', { status: 404 });
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, label)).limit(1);
      if (project) return new Response('ok');
      const [deployment] = await db.select({ id: deployments.id }).from(deployments).where(eq(deployments.subdomain, label)).limit(1);
      return deployment ? new Response('ok') : new Response('unknown', { status: 404 });
    }

    const [domain] = await db
      .select({ domain: domains.domain })
      .from(domains)
      .where(and(eq(domains.domain, host), isNotNull(domains.verifiedAt)))
      .limit(1);
    return domain ? new Response('ok') : new Response('unknown', { status: 404 });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', msg: 'caddy ask failed', err: String(error) }));
    return new Response('error', { status: 500 });
  }
}
