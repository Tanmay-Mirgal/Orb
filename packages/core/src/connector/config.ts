import { env, envBool } from '../config';

/** The whole connector (routes, UI, outbox writers, worker jobs) is off unless `CONNECTOR_ENABLED=true`. */
export function connectorEnabled(): boolean {
  return envBool('CONNECTOR_ENABLED', false);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https everywhere; plain http only for localhost and only outside production. */
export function isAcceptableRedirectUri(raw: string, production = process.env.NODE_ENV === 'production'): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && !production && LOOPBACK_HOSTS.has(url.hostname);
}

export interface ConnectorConfig {
  hubName: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  tokenPepper: string;
  /** Development only: lets webhook endpoints point at loopback/private addresses (never honoured in production). */
  allowPrivateWebhooks: boolean;
  docsUrl: string | undefined;
}

const MIN_SECRET_LENGTH = 32;

/** Human-readable problems with the connector environment; empty when it is complete (or the connector is off). */
export function connectorConfigProblems(): string[] {
  if (!connectorEnabled()) return [];
  const problems: string[] = [];
  if (!env('CONNECTOR_HUB_CLIENT_ID')) problems.push('CONNECTOR_HUB_CLIENT_ID is required');
  const secret = env('CONNECTOR_HUB_CLIENT_SECRET');
  if (!secret) problems.push('CONNECTOR_HUB_CLIENT_SECRET is required');
  else if (secret.length < MIN_SECRET_LENGTH) problems.push(`CONNECTOR_HUB_CLIENT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -hex 32)`);

  const redirects = (env('CONNECTOR_HUB_REDIRECT_URIS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (redirects.length === 0) problems.push('CONNECTOR_HUB_REDIRECT_URIS is required (comma separated, exact match)');
  for (const uri of redirects) {
    if (!isAcceptableRedirectUri(uri)) problems.push(`CONNECTOR_HUB_REDIRECT_URIS: "${uri}" must be an https URL without fragment (http://localhost is allowed outside production)`);
  }

  const pepper = env('CONNECTOR_TOKEN_PEPPER');
  if (!pepper) problems.push('CONNECTOR_TOKEN_PEPPER is required (openssl rand -hex 32)');
  else if (pepper.length < MIN_SECRET_LENGTH) problems.push(`CONNECTOR_TOKEN_PEPPER must be at least ${MIN_SECRET_LENGTH} characters`);

  const key = env('CONNECTOR_ENCRYPTION_KEY');
  if (!key) problems.push('CONNECTOR_ENCRYPTION_KEY is required (openssl rand -hex 32)');
  else if (key.length < MIN_SECRET_LENGTH) problems.push(`CONNECTOR_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters`);
  if (pepper && key && pepper === key) problems.push('CONNECTOR_TOKEN_PEPPER and CONNECTOR_ENCRYPTION_KEY must be different values');
  return problems;
}

/** Fails fast with every problem at once. No-op while the connector is disabled. */
export function assertConnectorConfig(): void {
  const problems = connectorConfigProblems();
  if (problems.length > 0) {
    throw new Error(`CONNECTOR_ENABLED=true but the connector is not configured correctly:\n - ${problems.join('\n - ')}`);
  }
}

export function connectorConfig(): ConnectorConfig {
  assertConnectorConfig();
  return {
    hubName: env('CONNECTOR_HUB_NAME') ?? 'Hub',
    clientId: env('CONNECTOR_HUB_CLIENT_ID') ?? '',
    clientSecret: env('CONNECTOR_HUB_CLIENT_SECRET') ?? '',
    redirectUris: (env('CONNECTOR_HUB_REDIRECT_URIS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    tokenPepper: env('CONNECTOR_TOKEN_PEPPER') ?? '',
    allowPrivateWebhooks: process.env.NODE_ENV !== 'production' && envBool('CONNECTOR_ALLOW_PRIVATE_WEBHOOKS', false),
    docsUrl: env('CONNECTOR_DOCS_URL'),
  };
}
