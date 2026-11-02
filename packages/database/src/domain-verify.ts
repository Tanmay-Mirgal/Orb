import { checkRouting, generateDomainVerificationToken, platformConfig, verifyOwnership } from 'core';
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { domains, type Domain } from './schema';

export interface DomainRefresh {
  domain: Domain;
  /** True when verifiedAt/status changed: edge route caches must be invalidated. */
  changed: boolean;
  ownership: { ok: boolean; detail: string };
  routing: { ok: boolean; detail: string } | null;
}

/**
 * Re-evaluates a domain against DNS and persists the result.
 *   pending  -> ownership TXT record not found yet
 *   verified -> ownership proven, but DNS does not route to Orb (yet)
 *   active   -> ownership proven and DNS routes to Orb
 * Once ownership is proven it is kept (the edge only serves domains with `verifiedAt`).
 */
export async function refreshDomain(db: Database, row: Domain): Promise<DomainRefresh> {
  const token = row.verificationToken ?? generateDomainVerificationToken();
  let verifiedAt = row.verifiedAt;
  let ownership: DomainRefresh['ownership'] = { ok: true, detail: 'Ownership already verified' };

  if (!verifiedAt) {
    ownership = await verifyOwnership(row.domain, token);
    if (ownership.ok) verifiedAt = new Date();
  }

  let routing: DomainRefresh['routing'] = null;
  let status: Domain['status'] = 'pending';
  let lastError: string | null = ownership.ok ? null : ownership.detail;
  if (verifiedAt) {
    const { cnameTarget, platformIps } = platformConfig();
    routing = await checkRouting(row.domain, { cnameTarget, platformIps });
    status = routing.ok ? 'active' : 'verified';
    lastError = routing.ok ? null : routing.detail;
  }

  const changed = status !== row.status || Boolean(verifiedAt) !== Boolean(row.verifiedAt);
  const now = new Date();
  const [updated] = await db
    .update(domains)
    .set({ status, verifiedAt, verificationToken: token, lastCheckedAt: now, lastError, updatedAt: now })
    .where(eq(domains.domain, row.domain))
    .returning();

  return { domain: updated ?? row, changed, ownership, routing };
}
