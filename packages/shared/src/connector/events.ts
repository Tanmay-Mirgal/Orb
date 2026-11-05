import { z } from 'zod';
import { CONNECTOR_API_VERSION, CONNECTOR_SERVICE, annotate, dateTime, externalRefSchema } from './common';
import { projectEntitySchema, triggeredBySchema } from './entities';
import type { ConnectorScope } from './scopes';

/**
 * Event catalogue. `data` never contains secrets, environment variable values, registry credentials or build logs.
 */
export interface EventDefinition {
  type: string;
  description: string;
  /** All of these must be held (after the user's role cap) for an endpoint to receive the event. */
  scopes: readonly ConnectorScope[];
  data: z.ZodType;
}

const projectRef = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  type: z.string(),
  url: z.string().nullable(),
});
export type EventProjectRef = z.infer<typeof projectRef>;

const deploymentRef = z.object({
  id: z.string(),
  environment: z.enum(['production', 'preview']),
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  commitMessage: z.string().nullable(),
  status: z.string(),
  url: z.string().nullable(),
  triggeredBy: triggeredBySchema,
  buildDurationMs: z.number().optional(),
  errorMessage: z.string().optional(),
});
export type EventDeploymentRef = z.infer<typeof deploymentRef>;

const deploymentData = z.object({ project: projectRef, deployment: deploymentRef, webUrl: z.string() });
export type DeploymentEventData = z.infer<typeof deploymentData>;

const promotedData = deploymentData.extend({
  previousDeploymentId: z.string().nullable().meta({ title: 'Previously live deployment' }),
});

const projectData = z.object({ project: projectEntitySchema });

const instancesSummary = z.object({
  desired: z.number(),
  running: z.number(),
  unhealthy: z.number(),
  lost: z.number(),
});
const serviceData = z.object({ project: projectRef, instances: instancesSummary });

const domainRef = z.object({
  domain: z.string(),
  status: z.enum(['pending', 'verified', 'active', 'error']),
  lastError: z.string().nullable(),
  redirectTo: z.string().nullable(),
});
const domainData = z.object({ project: projectRef, domain: domainRef });

const envUpdatedData = z.object({
  project: projectRef,
  keys: annotate(z.array(z.string()), 'Changed keys', 'Keys only, never values.'),
  target: z.enum(['all', 'production', 'preview']),
  action: z.enum(['set', 'removed']).optional(),
});

const planLimitData = z.object({
  limit: z.number().nullable(),
  kind: z.enum(['projects', 'container_projects', 'instances', 'domains', 'preview_deployments', 'concurrent_builds', 'instance_size', 'other']),
});

const def = (type: string, description: string, scopes: readonly ConnectorScope[], data: z.ZodType): EventDefinition => ({ type, description, scopes, data });

export const EVENTS: readonly EventDefinition[] = [
  def('project.created', 'A project was created (in the dashboard or through the connector).', ['orb:projects:read'], projectData),
  def('project.updated', 'Project settings changed.', ['orb:projects:read'], projectData),
  def('project.deleted', 'A project was deleted. `project` is its last known state.', ['orb:projects:read'], projectData),
  def('deployment.queued', 'A deployment was created and is waiting for a build slot.', ['orb:deployments:read'], deploymentData),
  def('deployment.building', 'The build started.', ['orb:deployments:read'], deploymentData),
  def('deployment.deploying', 'The image is built; instances are being started.', ['orb:deployments:read'], deploymentData),
  def('deployment.ready', 'The deployment is healthy and published. Emitted once per deployment.', ['orb:deployments:read'], deploymentData),
  def('deployment.failed', 'The build or release failed (or timed out). `deployment.errorMessage` says why. Emitted once per deployment.', ['orb:deployments:read'], deploymentData),
  def('deployment.canceled', 'The deployment was canceled.', ['orb:deployments:read'], deploymentData),
  def('deployment.promoted', 'The deployment became the live production deployment (automatically after READY, manually or as a rollback).', ['orb:deployments:read'], promotedData),
  def('service.unhealthy', 'A running service lost or has unhealthy instances. At most one event per project every 10 minutes.', ['orb:projects:read'], serviceData),
  def('service.recovered', 'A service that was reported unhealthy has all its instances running again.', ['orb:projects:read'], serviceData),
  def('domain.added', 'A custom domain was attached to a project.', ['orb:domains:read'], domainData),
  def('domain.verified', 'A custom domain now routes to Orb and serves traffic with TLS.', ['orb:domains:read'], domainData),
  def('domain.verification_failed', 'A previously working custom domain no longer routes to Orb.', ['orb:domains:read'], domainData),
  def('env.updated', 'Environment variables changed. Keys only. One event per request, however many variables it touched.', ['orb:projects:read'], envUpdatedData),
  def('plan.limit_reached', 'An action was refused because of a plan limit. At most one event per team and limit kind every 10 minutes.', ['orb:orgs:read'], planLimitData),
];

export const EVENT_TYPES = EVENTS.map((e) => e.type);
export type ConnectorEventType = (typeof EVENTS)[number]['type'];

export function getEventDefinition(type: string): EventDefinition | undefined {
  return EVENTS.find((e) => e.type === type);
}

/** Subscriptions accept exact types and `prefix.*`; `*` matches everything. */
export function isValidEventFilter(filter: string): boolean {
  if (filter === '*') return true;
  if (filter.endsWith('.*')) return EVENTS.some((e) => e.type.startsWith(filter.slice(0, -1)));
  return EVENTS.some((e) => e.type === filter);
}

export function eventMatchesFilter(type: string, filters: readonly string[]): boolean {
  return filters.some((f) => f === '*' || f === type || (f.endsWith('.*') && type.startsWith(f.slice(0, -1))));
}

export const eventEnvelopeSchema = z.object({
  id: annotate(z.string(), 'Event id', 'Unique per event; consumers dedupe on it.', ['evt_01J0ABCDEFGHJKMNPQRSTVWXYZ']),
  type: z.string(),
  apiVersion: z.literal(CONNECTOR_API_VERSION),
  service: z.literal(CONNECTOR_SERVICE),
  occurredAt: dateTime('Occurred at'),
  tenantId: z.string(),
  actor: z.object({ id: z.string().nullable(), name: z.string().nullable(), kind: z.enum(['user', 'system', 'connector']) }),
  externalRef: externalRefSchema.meta({ description: 'Always present; empty when the entity carries no correlation ids.' }),
  data: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
