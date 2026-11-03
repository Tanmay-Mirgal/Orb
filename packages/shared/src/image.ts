/**
 * Docker image references (`nginx:1.27`, `ghcr.io/acme/api@sha256:…`) for projects that deploy a prebuilt image.
 * Isomorphic: used by the dashboard form, the API schema and the build worker, which all validate the same way
 * because the reference ends up as an argument of `docker pull`.
 */

export interface ImageReference {
  /** Registry host as Docker resolves it (`docker.io` for bare names). */
  registry: string;
  /** Repository path inside the registry, e.g. `library/nginx`. */
  repository: string;
  tag: string | null;
  digest: string | null;
}

const DOMAIN_LABEL = '(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])';
const HOST_RE = new RegExp(`^${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*(?::[0-9]{1,5})?$`);
const PATH_COMPONENT_RE = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

export const DOCKER_HUB = 'docker.io';

/** Lower-cases a registry host and folds Docker Hub's alias hostnames into `docker.io`. */
export function normalizeRegistryHost(host: string): string {
  const lower = host.toLowerCase();
  return lower === 'index.docker.io' || lower === 'registry-1.docker.io' || lower === 'registry.hub.docker.com' ? DOCKER_HUB : lower;
}

/** Splits the registry host off like the Docker CLI does: the first segment is a host if it has a `.`/`:` or is `localhost`. */
function splitRegistry(name: string): { registry: string; path: string } {
  const slash = name.indexOf('/');
  if (slash === -1) return { registry: DOCKER_HUB, path: name };
  const first = name.slice(0, slash);
  if (first.includes('.') || first.includes(':') || first === 'localhost') return { registry: first, path: name.slice(slash + 1) };
  return { registry: DOCKER_HUB, path: name };
}

export function parseImageReference(input: string): ImageReference | null {
  const ref = input.trim();
  if (!ref || ref.length > 255 || /\s/.test(ref) || ref.startsWith('-')) return null;

  let rest = ref;
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!DIGEST_RE.test(digest)) return null;
  }

  // A `:` after the last `/` is the tag separator; one before it belongs to the registry port.
  let tag: string | null = null;
  const colon = rest.lastIndexOf(':');
  if (colon > rest.lastIndexOf('/')) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!TAG_RE.test(tag)) return null;
  }
  if (!rest) return null;

  const split = splitRegistry(rest);
  if (!HOST_RE.test(split.registry)) return null;
  const registry = normalizeRegistryHost(split.registry);
  const parts = split.path.split('/');
  if (parts.length === 0 || !parts.every((p) => PATH_COMPONENT_RE.test(p))) return null;

  const repository = registry === DOCKER_HUB && parts.length === 1 ? `library/${split.path}` : split.path;
  return { registry, repository, tag, digest };
}

/** Name shown in the dashboard: the repository's last path segment (`ghcr.io/acme/api:1` -> `api`). */
export function imageDisplayName(input: string): string {
  const parsed = parseImageReference(input);
  const last = (parsed?.repository ?? input).split('/').pop() ?? input;
  return last || input;
}

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/**
 * Registries the platform must never reach on a customer's behalf: loopback and private addresses, link-local
 * metadata endpoints and single-label hosts, which inside a Docker network resolve to internal services
 * (Orb's own registry, Postgres, Redis). Real public registries always have a dot in their name.
 */
export function isBlockedRegistryHost(registry: string): boolean {
  const host = registry.replace(/:\d+$/, '').toLowerCase();
  if (host === DOCKER_HUB) return false;
  if (!host.includes('.')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return PRIVATE_IPV4.some((re) => re.test(host));
  return host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || host.endsWith('.lan');
}

/** Key under which `docker login` stores credentials for a registry (Docker Hub uses a legacy URL). */
export function registryAuthKey(registry: string): string {
  return normalizeRegistryHost(registry) === DOCKER_HUB ? 'https://index.docker.io/v1/' : registry;
}

/** Why a reference is unusable, or `null` when it is fine. Shown next to the input and returned by the API. */
export function imageReferenceError(input: string): string | null {
  const parsed = parseImageReference(input);
  if (!parsed) return 'Enter an image like nginx:1.27 or ghcr.io/owner/app:latest';
  if (isBlockedRegistryHost(parsed.registry)) return 'That registry address is not reachable from Orb. Use a public registry host.';
  return null;
}
