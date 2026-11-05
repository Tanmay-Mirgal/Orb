import { z } from 'zod';
import { pageQuerySchema, pageSchema } from './common';
import {
  analyticsSchema,
  deploymentEntitySchema,
  domainEntitySchema,
  envVarEntitySchema,
  githubBranchEntitySchema,
  githubRepoEntitySchema,
  logPageSchema,
  orgEntitySchema,
  projectEntitySchema,
  runtimeLogPageSchema,
  usageEntitySchema,
} from './entities';
import type { ConnectorScope } from './scopes';

export interface ResourceDefinition {
  name: string;
  method: 'GET';
  /** Relative to `/api/connect/v1`. `{id}` is the entity id. */
  path: string;
  description: string;
  scopes: readonly ConnectorScope[];
  query: z.ZodType;
  output: z.ZodType;
  paginated: boolean;
}

const none = z.strictObject({});

const projectListQuery = pageQuerySchema.extend({
  type: z.enum(['static', 'web_service', 'worker', 'cron']).optional().meta({ title: 'Type filter' }),
  query: z.string().max(100).optional().meta({ title: 'Search', description: 'Matches the project name or slug.' }),
});

const deploymentListQuery = pageQuerySchema.extend({
  environment: z.enum(['production', 'preview']).optional().meta({ title: 'Environment filter' }),
  status: z.enum(['QUEUED', 'BUILDING', 'DEPLOYING', 'READY', 'FAILED', 'CANCELED', 'ARCHIVED']).optional().meta({ title: 'Status filter' }),
});

const logQuery = z.strictObject({
  cursor: z.string().max(64).optional().meta({ title: 'Cursor', description: 'From the previous response; omit to start at the first line.' }),
});

const analyticsQuery = z.strictObject({
  range: z.enum(['24h', '7d', '30d']).default('24h').meta({ title: 'Range' }),
});

const branchesQuery = pageQuerySchema.extend({
  repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/).meta({ title: 'Repository', description: 'owner/name', examples: ['acme/storefront'] }),
});

export const RESOURCES = {
  'orgs.list': {
    name: 'orgs.list',
    method: 'GET',
    path: '/orgs',
    description: 'The team this connection is pinned to, with the connecting user\'s role and the plan summary.',
    scopes: ['orb:orgs:read'],
    query: none,
    output: pageSchema(orgEntitySchema),
    paginated: false,
  },
  'projects.list': {
    name: 'projects.list',
    method: 'GET',
    path: '/projects',
    description: 'Projects of the team, newest first.',
    scopes: ['orb:projects:read'],
    query: projectListQuery,
    output: pageSchema(projectEntitySchema),
    paginated: true,
  },
  'projects.get': {
    name: 'projects.get',
    method: 'GET',
    path: '/projects/{id}',
    description: 'One project.',
    scopes: ['orb:projects:read'],
    query: none,
    output: projectEntitySchema,
    paginated: false,
  },
  'projects.deployments': {
    name: 'projects.deployments',
    method: 'GET',
    path: '/projects/{id}/deployments',
    description: 'Deployments of a project, newest first.',
    scopes: ['orb:deployments:read'],
    query: deploymentListQuery,
    output: pageSchema(deploymentEntitySchema),
    paginated: true,
  },
  'deployments.get': {
    name: 'deployments.get',
    method: 'GET',
    path: '/deployments/{id}',
    description: 'One deployment: status, branch, commit, environment, URL, build duration and error.',
    scopes: ['orb:deployments:read'],
    query: none,
    output: deploymentEntitySchema,
    paginated: false,
  },
  'deployments.logs': {
    name: 'deployments.logs',
    method: 'GET',
    path: '/deployments/{id}/logs',
    description: 'Build log lines. Poll with the returned cursor until done is true.',
    scopes: ['orb:logs:read'],
    query: logQuery,
    output: logPageSchema,
    paginated: true,
  },
  'projects.runtimeLogs': {
    name: 'projects.runtimeLogs',
    method: 'GET',
    path: '/projects/{id}/runtime-logs',
    description: 'Runtime logs of the live deployment of a project.',
    scopes: ['orb:logs:read'],
    query: logQuery,
    output: runtimeLogPageSchema,
    paginated: true,
  },
  'projects.analytics': {
    name: 'projects.analytics',
    method: 'GET',
    path: '/projects/{id}/analytics',
    description: 'Hourly requests, bandwidth, errors and latency.',
    scopes: ['orb:analytics:read'],
    query: analyticsQuery,
    output: analyticsSchema,
    paginated: false,
  },
  'projects.domains': {
    name: 'projects.domains',
    method: 'GET',
    path: '/projects/{id}/domains',
    description: 'Custom domains of a project with their DNS status and the records to create.',
    scopes: ['orb:domains:read'],
    query: none,
    output: pageSchema(domainEntitySchema),
    paginated: false,
  },
  'projects.env': {
    name: 'projects.env',
    method: 'GET',
    path: '/projects/{id}/env',
    description: 'Environment variables: key, scope, target and sensitivity. Values are only returned for non-sensitive variables.',
    scopes: ['orb:projects:read'],
    query: none,
    output: pageSchema(envVarEntitySchema),
    paginated: false,
  },
  'github.repos': {
    name: 'github.repos',
    method: 'GET',
    path: '/github/repos',
    description: "The connecting user's GitHub repositories, most recently pushed first.",
    scopes: ['orb:github:read'],
    query: pageQuerySchema,
    output: pageSchema(githubRepoEntitySchema),
    paginated: true,
  },
  'github.branches': {
    name: 'github.branches',
    method: 'GET',
    path: '/github/branches',
    description: 'Branches of one repository.',
    scopes: ['orb:github:read'],
    query: branchesQuery,
    output: pageSchema(githubBranchEntitySchema),
    paginated: true,
  },
  'usage.get': {
    name: 'usage.get',
    method: 'GET',
    path: '/usage',
    description: 'Plan quotas against current usage.',
    scopes: ['orb:orgs:read'],
    query: none,
    output: usageEntitySchema,
    paginated: false,
  },
} as const satisfies Record<string, ResourceDefinition>;

export type ResourceName = keyof typeof RESOURCES;
export const RESOURCE_NAMES = Object.keys(RESOURCES) as ResourceName[];
