import { and, deployments, eq, projectRepositories, projects } from 'database';
import { cpNotFound } from 'shared';
import { db } from '@/lib/db';
import type { ConnectorAuth } from './auth';

/**
 * Data access for the connector. Tenant isolation lives HERE, not in the route handlers: every query is constrained
 * to the team the grant is pinned to, so an id from another team is indistinguishable from an id that does not exist
 * (404, never 403), and ids cannot be probed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export async function pinnedProject(auth: Pick<ConnectorAuth, 'org'>, projectId: string) {
  if (!isUuid(projectId)) throw cpNotFound('Project');
  const [row] = await db
    .select({ project: projects, repository: projectRepositories })
    .from(projects)
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .where(and(eq(projects.id, projectId), eq(projects.orgId, auth.org.id)))
    .limit(1);
  if (!row) throw cpNotFound('Project');
  return row;
}

export async function pinnedDeployment(auth: Pick<ConnectorAuth, 'org'>, deploymentId: string) {
  if (!isUuid(deploymentId)) throw cpNotFound('Deployment');
  const [row] = await db
    .select({ deployment: deployments, project: projects, repository: projectRepositories })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .leftJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .where(and(eq(deployments.id, deploymentId), eq(projects.orgId, auth.org.id)))
    .limit(1);
  if (!row) throw cpNotFound('Deployment');
  return row;
}
