import { challengeHost, challengeValue, generateDomainVerificationToken, platformConfig, publishRouteInvalidation } from 'core';
import { and, count, domains, emitDomainEvent, eq, refreshDomain, type ActorSpec, type Domain, type Executor } from 'database';
import { getOrgPlan, isValidCustomDomain, looksLikeApexDomain, normalizeDomain } from 'shared';
import { db } from '@/lib/db';
import { badRequest, conflict, notFound, planLimit } from '../api';
import { getRedis } from '../infra';

export interface DnsInstruction {
  type: 'TXT' | 'CNAME' | 'A';
  host: string;
  value: string;
  purpose: 'ownership' | 'routing';
}

export interface DomainView extends Domain {
  instructions: DnsInstruction[];
}

/** What the customer must add at their DNS provider. Only CNAME (or A for apex) is needed. */
export function dnsInstructions(row: Domain): DnsInstruction[] {
  const { cnameTarget, platformIps } = platformConfig();
  const out: DnsInstruction[] = [];
  if (looksLikeApexDomain(row.domain) && platformIps.length > 0) {
    for (const ip of platformIps) out.push({ type: 'A', host: row.domain, value: ip, purpose: 'routing' });
  } else {
    out.push({ type: 'CNAME', host: row.domain, value: cnameTarget, purpose: 'routing' });
  }
  return out;
}

export function toView(row: Domain): DomainView {
  return { ...row, instructions: dnsInstructions(row) };
}

export async function listProjectDomains(projectId: string): Promise<DomainView[]> {
  const rows = await db.select().from(domains).where(eq(domains.projectId, projectId));
  return rows.map(toView);
}

export async function addDomain(options: {
  projectId: string;
  orgPlan: string;
  rawDomain: string;
  redirectTo?: string | null;
  actor?: ActorSpec;
}): Promise<DomainView> {
  const { baseDomain } = platformConfig();
  const domain = normalizeDomain(options.rawDomain);
  if (!isValidCustomDomain(domain, baseDomain)) {
    throw badRequest(`"${options.rawDomain}" is not a valid custom domain (platform subdomains cannot be used)`);
  }
  const redirectTo = options.redirectTo ? normalizeDomain(options.redirectTo) : null;
  if (redirectTo && (!isValidCustomDomain(redirectTo, baseDomain) || redirectTo === domain)) {
    throw badRequest('Invalid redirect target');
  }

  const plan = getOrgPlan(options.orgPlan);
  const [existingCount] = await db.select({ n: count() }).from(domains).where(eq(domains.projectId, options.projectId));
  if ((existingCount?.n ?? 0) >= plan.maxDomainsPerProject) {
    throw planLimit(`Your plan allows ${plan.maxDomainsPerProject} custom domains per project`, { limit: plan.maxDomainsPerProject, kind: 'domains' });
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(domains).where(eq(domains.domain, domain)).for('update');
    if (existing) {
      if (existing.projectId === options.projectId) throw conflict('This domain is already attached to the project');
      // An unverified claim is never served, so it cannot be relied upon: let the new claimant replace it.
      // This stops anyone from squatting a domain they do not own.
      if (existing.verifiedAt) throw conflict('This domain is already in use by another project');
      await tx.delete(domains).where(eq(domains.domain, domain));
    }
    const [row] = await tx
      .insert(domains)
      .values({
        domain,
        projectId: options.projectId,
        status: 'pending',
        verificationToken: generateDomainVerificationToken(),
        redirectTo,
      })
      .returning();
    await emitDomainEvent(tx as unknown as Executor, row!, 'added', options.actor ?? { kind: 'user' });
    return toView(row!);
  });
}

export async function verifyDomain(projectId: string, domainName: string, actor: ActorSpec = { kind: 'user' }): Promise<{ domain: DomainView; ownership: { ok: boolean; detail: string }; routing: { ok: boolean; detail: string } | null }> {
  const domain = normalizeDomain(domainName);
  const [row] = await db.select().from(domains).where(and(eq(domains.domain, domain), eq(domains.projectId, projectId)));
  if (!row) throw notFound('Domain');
  const result = await refreshDomain(db, row, actor);
  if (result.changed) await publishRouteInvalidation(getRedis(), { projectId });
  return { domain: toView(result.domain), ownership: result.ownership, routing: result.routing };
}

export async function updateDomainRedirect(projectId: string, domainName: string, redirectTo: string | null): Promise<DomainView> {
  const domain = normalizeDomain(domainName);
  const { baseDomain } = platformConfig();
  const target = redirectTo ? normalizeDomain(redirectTo) : null;
  if (target && (!isValidCustomDomain(target, baseDomain) || target === domain)) throw badRequest('Invalid redirect target');
  const [row] = await db
    .update(domains)
    .set({ redirectTo: target, updatedAt: new Date() })
    .where(and(eq(domains.domain, domain), eq(domains.projectId, projectId)))
    .returning();
  if (!row) throw notFound('Domain');
  await publishRouteInvalidation(getRedis(), { projectId });
  return toView(row);
}

export async function removeDomain(projectId: string, domainName: string): Promise<void> {
  const domain = normalizeDomain(domainName);
  const deleted = await db
    .delete(domains)
    .where(and(eq(domains.domain, domain), eq(domains.projectId, projectId)))
    .returning({ domain: domains.domain });
  if (deleted.length === 0) throw notFound('Domain');
  await publishRouteInvalidation(getRedis(), { projectId });
}
