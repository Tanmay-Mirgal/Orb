import { platformConfig } from 'core';
import { projectWebUrl, type Organization, type Project } from 'database';
import type { DomainEntity, EnvVarEntity, Role } from 'shared';
import { getOrgPlan } from 'shared';
import type { DomainView } from '../services/domains';
import type { EnvVarView } from '../services/env';
import { planLimits } from './usage';

/** Projections for entities that only the web app returns (the rest live in `database/connector-entities`). */

export function toOrgEntity(org: Organization, role: Role) {
  const plan = getOrgPlan(org.plan);
  return {
    id: org.id,
    webUrl: `${platformConfig().dashboardUrl}/dashboard/team`,
    name: org.name,
    slug: org.slug,
    role,
    plan: { id: plan.id, name: plan.name, expiresAt: org.planExpiresAt ? org.planExpiresAt.toISOString() : null, limits: planLimits(org) as unknown as Record<string, unknown> },
    createdAt: org.createdAt.toISOString(),
  };
}

export function toDomainEntity(view: DomainView, project: Pick<Project, 'slug'>): DomainEntity {
  return {
    id: view.domain,
    webUrl: projectWebUrl(project),
    domain: view.domain,
    projectId: view.projectId,
    status: view.status as DomainEntity['status'],
    verified: view.verifiedAt !== null,
    lastCheckedAt: view.lastCheckedAt ? view.lastCheckedAt.toISOString() : null,
    lastError: view.lastError,
    redirectTo: view.redirectTo,
    instructions: view.instructions,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

/** Values are only ever present for non-sensitive variables (the service already withholds the others). */
export function toEnvVarEntity(view: EnvVarView): EnvVarEntity {
  return {
    id: view.id,
    key: view.key,
    value: view.isSecret ? null : view.value,
    target: view.target as EnvVarEntity['target'],
    scope: view.scope as EnvVarEntity['scope'],
    sensitive: view.isSecret,
    updatedAt: view.updatedAt.toISOString(),
  };
}
