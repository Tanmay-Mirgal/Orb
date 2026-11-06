import { checkRouting, generateDomainVerificationToken, platformConfig, verifyOwnership } from 'core';
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { emitDomainEvent, withOutbox, SYSTEM_ACTOR, type ActorSpec } from './connector';
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
 *   pending  -> DNS does not route to Orb yet
 *   active   -> DNS routes to Orb (or verified via TXT)
 * A CNAME or A record pointing to Orb proves ownership directly.
 */
export async function refreshDomain(db: Database, row: Domain, actor: ActorSpec = SYSTEM_ACTOR): Promise<DomainRefresh> {
  const token = row.verificationToken ?? generateDomainVerificationToken();
  const { cnameTarget, platformIps } = platformConfig();

  // 1. Check CNAME or A routing first (most users only configure CNAME/A)
  const routing = await checkRouting(row.domain, { cnameTarget, platformIps });

  let verifiedAt = row.verifiedAt;
  let ownership: DomainRefresh['ownership'] = { ok: true, detail: 'Ownership verified via DNS routing' };

  if (routing.ok) {
    // If DNS routes to Orb, ownership is proven by the CNAME/A record itself!
    verifiedAt = verifiedAt ?? new Date();
  } else if (!verifiedAt) {
    // Fallback: check TXT record if someone added one
    ownership = await verifyOwnership(row.domain, token);
    if (ownership.ok) verifiedAt = new Date();
  }

  const status: Domain['status'] = (verifiedAt && routing.ok) ? 'active' : (verifiedAt ? 'verified' : 'pending');
  const lastError: string | null = routing.ok ? null : (verifiedAt ? routing.detail : (routing.detail || ownership.detail));

  const changed = status !== row.status || Boolean(verifiedAt) !== Boolean(row.verifiedAt);
  const now = new Date();
  const updated = await withOutbox(db, async (tx) => {
    const [saved] = await tx
      .update(domains)
      .set({ status, verifiedAt, verificationToken: token, lastCheckedAt: now, lastError, updatedAt: now })
      .where(eq(domains.domain, row.domain))
      .returning();
    // Events only for real transitions of "serving traffic", written with the status change.
    if (saved && status === 'active' && row.status !== 'active') await emitDomainEvent(tx, saved, 'verified', actor);
    else if (saved && status !== 'active' && row.status === 'active') await emitDomainEvent(tx, saved, 'verification_failed', actor);
    return saved;
  });

  return { domain: updated ?? row, changed, ownership, routing };
}
