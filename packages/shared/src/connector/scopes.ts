import { can, type Permission } from '../permissions';

/**
 * CP1 scopes. Every scope maps to the Orb permission(s) a user needs in the pinned team; the consent page only offers
 * a scope when the user's role satisfies it, and the check is repeated on every request (a downgrade takes effect at once).
 */
export interface ScopeDefinition {
  name: ConnectorScope;
  /** Shown in the manifest. */
  description: string;
  /** Plain language for the consent screen. */
  consent: string;
  /** All of these must be held by the user's current role. */
  permissions: readonly Permission[];
  write: boolean;
}

export const CONNECTOR_SCOPE_NAMES = [
  'orb:orgs:read',
  'orb:projects:read',
  'orb:projects:write',
  'orb:deployments:read',
  'orb:deployments:write',
  'orb:env:write',
  'orb:domains:read',
  'orb:domains:write',
  'orb:logs:read',
  'orb:analytics:read',
  'orb:github:read',
  'orb:events:read',
  'orb:webhooks:manage',
] as const;
export type ConnectorScope = (typeof CONNECTOR_SCOPE_NAMES)[number];

export const SCOPE_DEFINITIONS: readonly ScopeDefinition[] = [
  { name: 'orb:orgs:read', description: 'Read the team (organization) the app is connected to, with its plan and quotas', consent: 'See the name, plan and usage of your team', permissions: ['org:read'], write: false },
  { name: 'orb:projects:read', description: 'Read projects and their configuration (environment variable values of sensitive variables are never returned)', consent: 'See your projects and their settings', permissions: ['project:read'], write: false },
  { name: 'orb:projects:write', description: 'Create and update projects', consent: 'Create and change projects', permissions: ['project:create', 'project:update'], write: true },
  { name: 'orb:deployments:read', description: 'Read deployments and their status', consent: 'See deployments and whether they succeeded', permissions: ['project:read'], write: false },
  { name: 'orb:deployments:write', description: 'Trigger, cancel, redeploy and (as an admin) promote deployments', consent: 'Start, cancel and redeploy deployments', permissions: ['deployment:create'], write: true },
  { name: 'orb:env:write', description: 'Set and remove environment variables', consent: 'Set and remove environment variables (values are write-only)', permissions: ['env:write'], write: true },
  { name: 'orb:domains:read', description: 'Read custom domains and their DNS status', consent: 'See custom domains and their DNS status', permissions: ['project:read'], write: false },
  { name: 'orb:domains:write', description: 'Add, verify and remove custom domains', consent: 'Add, verify and remove custom domains', permissions: ['domain:manage'], write: true },
  { name: 'orb:logs:read', description: 'Read build and runtime logs', consent: 'Read build and runtime logs', permissions: ['project:read'], write: false },
  { name: 'orb:analytics:read', description: 'Read traffic analytics', consent: 'See traffic analytics', permissions: ['project:read'], write: false },
  { name: 'orb:github:read', description: "List the connecting user's GitHub repositories and branches and detect frameworks", consent: 'List your GitHub repositories and branches to set up projects', permissions: ['project:create'], write: false },
  { name: 'orb:events:read', description: "Read the team's event log (polling fallback for webhooks)", consent: 'Read what happens in your team (deployments, domains, …)', permissions: ['project:read'], write: false },
  { name: 'orb:webhooks:manage', description: 'Register and manage webhook endpoints owned by this connection', consent: 'Send you notifications about deployments through webhooks', permissions: ['token:manage'], write: true },
];

const BY_NAME = new Map(SCOPE_DEFINITIONS.map((s) => [s.name, s]));

export function isConnectorScope(value: string): value is ConnectorScope {
  return BY_NAME.has(value as ConnectorScope);
}

export function scopeDefinition(scope: ConnectorScope): ScopeDefinition {
  return BY_NAME.get(scope)!;
}

/** True when `role` holds every permission the scope needs. */
export function roleSatisfiesScope(role: string | null | undefined, scope: ConnectorScope): boolean {
  return scopeDefinition(scope).permissions.every((p) => can(role, p));
}

/** Scopes among `requested` that `role` may be granted. Webhook management always comes with event-log access. */
export function grantableScopes(role: string | null | undefined, requested: readonly ConnectorScope[]): ConnectorScope[] {
  const out = new Set<ConnectorScope>(requested.filter((s) => roleSatisfiesScope(role, s)));
  if (out.has('orb:webhooks:manage') && roleSatisfiesScope(role, 'orb:events:read')) out.add('orb:events:read');
  return CONNECTOR_SCOPE_NAMES.filter((s) => out.has(s));
}

/** The grant's stored scopes, capped by what the user's role can do right now. */
export function effectiveScopes(role: string | null | undefined, granted: readonly string[]): ConnectorScope[] {
  return grantableScopes(role, granted.filter(isConnectorScope));
}

export function parseScopeParam(value: string | null | undefined): { scopes: ConnectorScope[]; unknown: string[] } {
  const parts = (value ?? '').split(/[\s,]+/).filter(Boolean);
  const unknown = parts.filter((p) => !isConnectorScope(p));
  const scopes = [...new Set(parts.filter(isConnectorScope))];
  return { scopes, unknown };
}
