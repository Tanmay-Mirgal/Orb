import { RESERVED_SLUGS } from './constants';

/** Lower-case, hyphen-separated, DNS-label-safe slug (max 40 chars, never empty). */
export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'project';
}

/** Slugs that collide with platform hostnames get a suffix by the caller. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidDnsLabel(label: string): boolean {
  return DNS_LABEL.test(label);
}

/** Hostname of the immutable per-deployment URL: `<project-slug>-<8 hex>`. */
export function deploymentSubdomain(projectSlug: string, deploymentId: string): string {
  const short = deploymentId.replace(/-/g, '').slice(0, 8);
  // DNS labels max out at 63 chars; keep room for "-" + 8 chars.
  return `${projectSlug.slice(0, 50).replace(/-+$/g, '')}-${short}`;
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Normalises user input (`https://Example.com/path`) into a bare lower-case hostname. */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export function isValidCustomDomain(domain: string, baseDomain?: string): boolean {
  if (!HOSTNAME.test(domain)) return false;
  // Punycode / IDN is accepted in its xn-- form only.
  if (baseDomain && (domain === baseDomain || domain.endsWith(`.${baseDomain}`))) return false;
  return true;
}

/** True for `example.com` (registrable apex-looking host with exactly one dot). Approximation, no PSL. */
export function looksLikeApexDomain(domain: string): boolean {
  return domain.split('.').length === 2;
}

export function shortId(id: string, length = 7): string {
  return id.replace(/-/g, '').slice(0, length);
}
