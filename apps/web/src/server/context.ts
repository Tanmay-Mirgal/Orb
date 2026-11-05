import { and, apiTokens, deployments, eq, memberships, organizations, projectRepositories, projects, users } from 'database';
import { API_TOKEN_PREFIX, sha256Hex } from 'core';
import { can, getOrgPlan, type Permission, type Role } from 'shared';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  ApiError,
  assertSameOrigin,
  assertUuid,
  clientIp,
  enforceRateLimit,
  forbidden,
  notFound,
  unauthorized,
} from './api';
import { ORG_COOKIE, resolveActiveOrg } from './orgs';
import type { Deployment, Organization, Project, ProjectRepository } from 'database';

export interface AuthContext {
  userId: string;
  userName: string;
  email: string;
  via: 'session' | 'token' | 'connector';
  tokenId?: string;
  ip: string | null;
  /** Set only for calls made through the ecosystem connector (see server/connector/auth). */
  connector?: { grantId: string; clientId: string; requestId: string };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Resolves the caller from a personal API token (`Authorization: Bearer orb_...`) or the session cookie. */
export async function authenticate(req: Request): Promise<AuthContext> {
  const ip = clientIp(req);
  await enforceRateLimit(`ip:${ip ?? 'unknown'}`, 600, 60);

  const header = req.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (!token.startsWith(API_TOKEN_PREFIX)) throw unauthorized('Invalid API token');
    const [row] = await db
      .select({ token: apiTokens, user: users })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(eq(apiTokens.tokenHash, sha256Hex(token)))
      .limit(1);
    if (!row || row.token.revokedAt || (row.token.expiresAt && row.token.expiresAt < new Date())) {
      throw unauthorized('Invalid or expired API token');
    }
    // Throttle bookkeeping writes to one per five minutes per token.
    if (!row.token.lastUsedAt || Date.now() - row.token.lastUsedAt.getTime() > 5 * 60_000) {
      void db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.token.id)).catch(() => undefined);
    }
    return { userId: row.user.id, userName: row.user.name, email: row.user.email, via: 'token', tokenId: row.token.id, ip };
  }

  assertSameOrigin(req);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) throw unauthorized();
  return { userId: session.user.id, userName: session.user.name, email: session.user.email, via: 'session', ip };
}

export interface OrgContext {
  org: Organization;
  role: Role;
}

/** Active organisation: `X-Orb-Org` header, `?orgId=`, the `orb_org` cookie, else the personal org. */
export async function orgContext(authCtx: AuthContext, req: Request, explicitOrgId?: string): Promise<OrgContext> {
  const requested =
    explicitOrgId ?? req.headers.get('x-orb-org') ?? new URL(req.url).searchParams.get('orgId') ?? readCookie(req, ORG_COOKIE);
  if (requested) assertUuid(requested, 'Organization');
  const active = await resolveActiveOrg({ id: authCtx.userId, name: authCtx.userName }, requested);
  if (requested && active.org.id !== requested) throw forbidden('You are not a member of this organization');
  await enforceRateLimit(`org:${active.org.id}`, getOrgPlan(active.org.plan).apiRatePerMinute, 60);
  return { org: active.org, role: active.role };
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw forbidden();
}

export interface ProjectContext extends OrgContext {
  project: Project;
  repository: ProjectRepository | null;
}

/**
 * Loads a project the caller may access. Non-members get a 404 (not 403) so project ids cannot be probed.
 */
export async function projectContext(
  authCtx: AuthContext,
  projectId: string,
  permission: Permission = 'project:read',
): Promise<ProjectContext> {
  assertUuid(projectId, 'Project');
  const [row] = await db
    .select({ project: projects, repository: projectRepositories, org: organizations, role: memberships.role })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(memberships, and(eq(memberships.orgId, projects.orgId), eq(memberships.userId, authCtx.userId)))
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) throw notFound('Project');
  const role = row.role as Role;
  requirePermission(role, permission);
  await enforceRateLimit(`org:${row.org.id}`, getOrgPlan(row.org.plan).apiRatePerMinute, 60);
  return { project: row.project, repository: row.repository, org: row.org, role };
}

/** Compact helper so route files read as: `const { auth, ... } = await authed(req)`. */
export async function authed(req: Request): Promise<AuthContext> {
  return authenticate(req);
}

export { ApiError };

export interface DeploymentContext extends ProjectContext {
  deployment: Deployment;
}

/** Loads a deployment the caller may access via its project's organisation. */
export async function deploymentContext(
  authCtx: AuthContext,
  deploymentId: string,
  permission: Permission = 'project:read',
): Promise<DeploymentContext> {
  assertUuid(deploymentId, 'Deployment');
  const [row] = await db.select({ projectId: deployments.projectId }).from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
  if (!row) throw notFound('Deployment');
  const ctx = await projectContext(authCtx, row.projectId, permission);
  const [deployment] = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
  if (!deployment) throw notFound('Deployment');
  return { ...ctx, deployment };
}
