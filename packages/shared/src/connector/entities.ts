import { z } from 'zod';
import { PROJECT_TYPES } from '../constants';
import { annotate, dateTime, externalRefSchema, metadataSchema } from './common';

/**
 * Entities returned by the connector. They are explicit projections of the database rows: nothing is spread from a
 * row, so a new column (or a secret) can never leak into the API by accident.
 */

const nullableString = (title: string, description?: string) => annotate(z.string().nullable(), title, description);
const url = (title: string, description?: string) => annotate(z.string().nullable(), title, description, ['https://my-app.orb.example.com']);

export const orgEntitySchema = z.object({
  id: z.string(),
  webUrl: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(['viewer', 'member', 'admin', 'owner']).meta({ title: 'Role of the connecting user in this team' }),
  plan: z.object({
    id: z.string(),
    name: z.string(),
    expiresAt: z.string().nullable(),
    limits: z.record(z.string(), z.unknown()),
  }),
  createdAt: dateTime('Created'),
});

export const projectEntitySchema = z.object({
  id: z.string(),
  webUrl: z.string(),
  name: z.string(),
  slug: nullableString('Slug', 'Subdomain label: <slug>.<base domain>'),
  type: z.enum(PROJECT_TYPES as unknown as [string, ...string[]]),
  source: z.enum(['git', 'image']),
  framework: nullableString('Framework'),
  url: url('Production URL'),
  repository: z.object({ fullName: z.string(), id: z.number(), branch: z.string() }).nullable(),
  image: nullableString('Docker image', 'Image reference of Docker image projects.'),
  rootDirectory: z.string(),
  installCommand: nullableString('Install command'),
  buildCommand: nullableString('Build command'),
  startCommand: nullableString('Start command'),
  outputDirectory: nullableString('Output directory'),
  port: z.number(),
  healthCheckPath: z.string(),
  instancePlan: z.string(),
  instanceCount: z.number(),
  cronSchedule: nullableString('Cron schedule'),
  autoDeploy: z.boolean(),
  previewDeployments: z.boolean(),
  currentDeploymentId: nullableString('Live deployment id'),
  sleeping: z.boolean().meta({ title: 'Sleeping', description: 'Hobby web services sleep when idle and wake on the next request.' }),
  createdAt: dateTime('Created'),
  updatedAt: dateTime('Updated'),
  metadata: metadataSchema.nullable(),
  externalRef: externalRefSchema.nullable(),
  createdVia: nullableString('Created via', "'connector' when created through the Hub, null for the Orb dashboard."),
});
export type ProjectEntity = z.infer<typeof projectEntitySchema>;

export const deploymentStatusSchema = z.enum(['QUEUED', 'BUILDING', 'DEPLOYING', 'READY', 'FAILED', 'CANCELED', 'ARCHIVED']);
export const triggeredBySchema = z.enum(['push', 'manual', 'api', 'redeploy', 'rollback']);

export const deploymentEntitySchema = z.object({
  id: z.string(),
  webUrl: z.string(),
  projectId: z.string(),
  status: deploymentStatusSchema,
  environment: z.enum(['production', 'preview']),
  branch: nullableString('Branch'),
  commitSha: nullableString('Commit SHA', 'For Docker image deployments: the image digest.'),
  commitMessage: nullableString('Commit message'),
  commitAuthor: nullableString('Commit author'),
  triggeredBy: triggeredBySchema,
  url: url('Immutable deployment URL'),
  isCurrent: z.boolean().meta({ title: 'Live', description: 'True when this is the production deployment.' }),
  buildDurationMs: z.number().nullable(),
  errorMessage: nullableString('Error message'),
  createdAt: dateTime('Created'),
  updatedAt: dateTime('Updated'),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  metadata: metadataSchema.nullable(),
  externalRef: externalRefSchema.nullable(),
  createdVia: nullableString('Created via'),
});
export type DeploymentEntity = z.infer<typeof deploymentEntitySchema>;

export const dnsInstructionSchema = z.object({
  type: z.enum(['TXT', 'CNAME', 'A']),
  host: z.string(),
  value: z.string(),
  purpose: z.enum(['ownership', 'routing']),
});

export const domainEntitySchema = z.object({
  id: z.string().meta({ title: 'Domain name (the id of a domain)' }),
  webUrl: z.string(),
  domain: z.string(),
  projectId: z.string(),
  status: z.enum(['pending', 'verified', 'active', 'error']),
  verified: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  lastError: nullableString('Last DNS error'),
  redirectTo: nullableString('Redirects to'),
  instructions: z.array(dnsInstructionSchema).meta({ title: 'DNS records to create' }),
  createdAt: dateTime('Created'),
  updatedAt: dateTime('Updated'),
});
export type DomainEntity = z.infer<typeof domainEntitySchema>;

export const envVarEntitySchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string().nullable().meta({ title: 'Value', description: 'Only for non-sensitive variables; null for sensitive ones.' }),
  target: z.enum(['all', 'production', 'preview']),
  scope: z.enum(['both', 'build', 'runtime']),
  sensitive: z.boolean(),
  updatedAt: dateTime('Updated'),
});
export type EnvVarEntity = z.infer<typeof envVarEntitySchema>;

export const githubRepoEntitySchema = z.object({
  id: z.number(),
  fullName: z.string(),
  private: z.boolean(),
  language: z.string().nullable(),
  defaultBranch: z.string(),
  pushedAt: z.string().nullable(),
  ownerLogin: z.string(),
});

export const githubBranchEntitySchema = z.object({ name: z.string() });

export const usageEntitySchema = z.object({
  plan: z.object({ id: z.string(), name: z.string() }),
  quotas: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      used: z.number(),
      limit: z.number().nullable(),
    }),
  ),
});

export const logLineSchema = z.object({ index: z.number(), text: z.string() });
export const logPageSchema = z.object({
  items: z.array(logLineSchema),
  nextCursor: z.string().nullable(),
  done: z.boolean().meta({ title: 'Done', description: 'True when the deployment finished and every line has been returned.' }),
  status: z.string(),
});

export const runtimeLogPageSchema = z.object({
  deploymentId: z.string().nullable(),
  items: z.array(z.object({ id: z.string(), stream: z.string().optional(), text: z.string(), at: z.string().optional() })),
  nextCursor: z.string().nullable(),
});

export const analyticsSchema = z.object({
  range: z.enum(['24h', '7d', '30d']),
  series: z.array(z.object({ bucket: z.string(), requests: z.number(), bytesOut: z.number(), errors: z.number(), avgMs: z.number() })),
  totals: z.object({ requests: z.number(), bytesOut: z.number(), s2xx: z.number(), s3xx: z.number(), s4xx: z.number(), s5xx: z.number(), avgMs: z.number() }),
});
