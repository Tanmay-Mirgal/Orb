import { z } from 'zod';
import { PROJECT_TYPES } from '../constants';
import {
  branchName,
  envKeySchema,
  envValueSchema,
  imageRefSchema,
  projectConfigSchema,
  registryCredentialsSchema,
  repoFullName,
} from '../schemas';
import { annotate, externalRefSchema, metadataSchema } from './common';
import { deploymentEntitySchema, domainEntitySchema, projectEntitySchema } from './entities';
import type { ConnectorScope } from './scopes';

/**
 * The action registry: the single source of truth for validation, the manifest and the OpenAPI document.
 * Handlers live in the web app (`server/connector/actions`) and are keyed by these names.
 */
export interface ActionDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** All of these are required. `projects.create` additionally needs `orb:deployments:write` when `deploy` is true. */
  scopes: readonly ConnectorScope[];
  async: boolean;
  /** True when the action honours the `Idempotency-Key` header. */
  idempotent: boolean;
  input: I;
  output: O;
}

function defineAction<I extends z.ZodType, O extends z.ZodType>(def: ActionDefinition<I, O>): ActionDefinition<I, O> {
  return def;
}

const projectId = annotate(z.string().uuid(), 'Project id', 'Id of an Orb project in the connected team.', ['3f6c7a0e-5f0b-4d0e-9c9e-2f4d9b1a7c11']);
const deploymentId = annotate(z.string().uuid(), 'Deployment id', 'Id of an Orb deployment in the connected team.', ['9b1e2c4a-1d3f-4a5b-8c7d-6e5f4a3b2c1d']);
const domainName = annotate(z.string().min(3).max(253), 'Domain', 'A custom domain, e.g. www.example.com', ['www.example.com']);

const strictRegistry = z.strictObject(registryCredentialsSchema.shape);

const repositoryInput = annotate(
  z.strictObject({
    fullName: annotate(repoFullName, 'Repository', 'GitHub repository as owner/name.', ['acme/storefront']),
    id: annotate(z.number().int().nonnegative().optional(), 'GitHub repository id', 'Optional; Orb takes the canonical id from GitHub.'),
    branch: annotate(branchName.optional(), 'Production branch', "Defaults to the repository's default branch.", ['main']),
  }),
  'GitHub repository',
);

export const connectorEnvVarSchema = z.strictObject({
  key: annotate(envKeySchema, 'Key', 'Letters, digits and underscores; must not start with a digit.', ['DATABASE_URL']),
  value: annotate(envValueSchema, 'Value', 'Stored encrypted. Never returned for sensitive variables.'),
  scope: annotate(z.enum(['both', 'build', 'runtime']).default('both'), 'Scope', 'Where the variable is available.'),
  target: annotate(z.enum(['all', 'production', 'preview']).default('all'), 'Target', 'Which deployments receive the variable.'),
  sensitive: annotate(z.boolean().default(true), 'Sensitive', 'Sensitive values can be replaced but never read back.'),
});
export type ConnectorEnvVarInput = z.infer<typeof connectorEnvVarSchema>;

const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  fixUrl: z.string().optional(),
});

const projectConfigShape = projectConfigSchema.shape;

export const projectsCreateInput = z
  .strictObject({
    name: annotate(z.string().trim().min(2).max(60), 'Name', 'Display name of the project.', ['Storefront']),
    type: annotate(z.enum(PROJECT_TYPES as unknown as [string, ...string[]]), 'Type', 'static | web_service | worker | cron'),
    source: annotate(z.enum(['git', 'image']).default('git'), 'Source', 'git builds a GitHub repository; image pulls a prebuilt Docker image.'),
    repository: repositoryInput.optional(),
    image: annotate(imageRefSchema.optional(), 'Docker image', 'Required when source is image, e.g. ghcr.io/acme/api:1.4'),
    registry: annotate(strictRegistry.optional(), 'Registry login', 'Login for a private registry. Stored encrypted, never returned.'),
    ...projectConfigShape,
    envVars: annotate(z.array(connectorEnvVarSchema).max(200).optional(), 'Environment variables', 'Created together with the project.'),
    deploy: annotate(z.boolean().default(true), 'Deploy now', 'Queue the first production deployment (needs the orb:deployments:write scope).'),
    metadata: metadataSchema.optional(),
    externalRef: externalRefSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'git') {
      if (!value.repository) ctx.addIssue({ code: 'custom', path: ['repository'], message: 'Choose a repository' });
    } else {
      if (!value.image) ctx.addIssue({ code: 'custom', path: ['image'], message: 'Enter a Docker image' });
      if (value.type === 'static') ctx.addIssue({ code: 'custom', path: ['type'], message: 'Static sites are built from a Git repository, not a Docker image' });
    }
  });
export type ProjectsCreateInput = z.infer<typeof projectsCreateInput>;

export const projectsCreateOutput = z.object({
  project: projectEntitySchema,
  repository: z.object({ fullName: z.string(), id: z.number(), branch: z.string() }).nullable(),
  deployment: deploymentEntitySchema.nullable(),
  autoDeploy: z.boolean().meta({ title: 'Push-to-deploy active', description: 'True when pushes to the repository trigger deployments (the Orb GitHub App is installed on it).' }),
  warnings: z.array(warningSchema),
  pushToDeployHint: z
    .object({ remote: z.string().nullable(), branch: z.string().nullable(), message: z.string() })
    .optional(),
});

export const projectsUpdateInput = z.strictObject({
  projectId,
  name: annotate(z.string().trim().min(2).max(60).optional(), 'Name'),
  branch: annotate(branchName.optional(), 'Production branch'),
  image: annotate(imageRefSchema.optional(), 'Docker image', 'Docker image projects only.'),
  registry: annotate(strictRegistry.nullable().optional(), 'Registry login', 'An object sets the login, null removes it. Docker image projects only.'),
  ...projectConfigShape,
  metadata: metadataSchema.optional(),
  externalRef: externalRefSchema.optional(),
});

export const detectFrameworkInput = z.strictObject({
  repository: z.strictObject({
    fullName: annotate(repoFullName, 'Repository', 'GitHub repository as owner/name.', ['acme/storefront']),
    branch: annotate(branchName.default('main'), 'Branch', undefined, ['main']),
  }),
  rootDirectory: annotate(z.string().max(255).optional(), 'Root directory', 'Sub-directory of a monorepo to analyse.'),
});

export const detectFrameworkOutput = z.object({
  detection: z.record(z.string(), z.unknown()).meta({ title: 'Detection', description: 'Framework, commands, output directory, port and a suggested project type.' }),
  suggestedType: z.enum(PROJECT_TYPES as unknown as [string, ...string[]]),
  hasDetectableFramework: z.boolean(),
});

export const deploymentsTriggerInput = z.strictObject({
  projectId,
  branch: annotate(branchName.optional(), 'Branch', "Defaults to the project's production branch."),
  environment: annotate(z.enum(['production', 'preview']).optional(), 'Environment', 'Defaults to production for the production branch, preview for any other.'),
  commitSha: annotate(z.string().regex(/^[a-f0-9]{7,40}$/i).optional(), 'Commit SHA', 'Defaults to the branch head.'),
  metadata: metadataSchema.optional(),
  externalRef: externalRefSchema.optional(),
});

export const deploymentOutput = z.object({ deployment: deploymentEntitySchema });

export const deploymentIdInput = z.strictObject({ deploymentId });
export const redeployInput = z.strictObject({ deploymentId, externalRef: externalRefSchema.optional(), metadata: metadataSchema.optional() });

export const promoteOutput = z.object({ deployment: deploymentEntitySchema, queued: z.boolean().meta({ title: 'Queued', description: 'Container deployments are (re)started first; static sites switch immediately.' }) });

export const envSetInput = z.union([
  z.strictObject({
    projectId,
    vars: annotate(z.array(connectorEnvVarSchema).min(1).max(200), 'Variables'),
  }),
  z.strictObject({
    projectId,
    dotenv: annotate(z.string().max(256 * 1024), 'dotenv', 'Contents of a .env file. Variables are stored as sensitive for all targets.'),
  }),
]);
export const envSetOutput = z.object({
  projectId: z.string(),
  count: z.number(),
  keys: z.array(z.object({ key: z.string(), target: z.string(), scope: z.string(), sensitive: z.boolean() })),
  skipped: z.array(z.string()).optional(),
});

export const envRemoveInput = z.strictObject({
  projectId,
  key: annotate(envKeySchema, 'Key'),
  target: annotate(z.enum(['all', 'production', 'preview']).default('all'), 'Target'),
});
export const envRemoveOutput = z.object({ projectId: z.string(), key: z.string(), target: z.string(), removed: z.boolean() });

export const domainAddInput = z.strictObject({
  projectId,
  domain: domainName,
  redirectTo: annotate(z.string().min(3).max(253).nullish(), 'Redirect to', 'Answer 308 redirects to this domain (e.g. www to apex).'),
});
export const domainRefInput = z.strictObject({ projectId, domain: domainName });
export const domainOutput = z.object({ domain: domainEntitySchema });
export const domainVerifyOutput = z.object({
  domain: domainEntitySchema,
  ownership: z.object({ ok: z.boolean(), detail: z.string() }),
  routing: z.object({ ok: z.boolean(), detail: z.string() }).nullable(),
});
export const domainRemoveOutput = z.object({ domain: z.string(), removed: z.boolean() });

export const waitForDeploymentInput = z.strictObject({
  deploymentId,
  timeoutSeconds: annotate(z.number().int().min(1).max(1800).default(900), 'Timeout (seconds)', 'Give up waiting after this long. Maximum 1800.'),
});

export const ACTIONS = {
  'projects.detectFramework': defineAction({
    name: 'projects.detectFramework',
    description: 'Analyse a GitHub repository with the same detector the build worker uses: framework, commands, output directory, port and a suggested project type.',
    scopes: ['orb:github:read'],
    async: false,
    idempotent: true,
    input: detectFrameworkInput,
    output: detectFrameworkOutput,
  }),
  'projects.create': defineAction({
    name: 'projects.create',
    description: 'Create a project from a GitHub repository or a prebuilt Docker image, optionally with environment variables, and queue the first deployment.',
    scopes: ['orb:projects:write'],
    async: false,
    idempotent: true,
    input: projectsCreateInput,
    output: projectsCreateOutput,
  }),
  'projects.update': defineAction({
    name: 'projects.update',
    description: 'Change a project: name, branch, build/start settings, instances, auto-deploy, previews, metadata and external reference.',
    scopes: ['orb:projects:write'],
    async: false,
    idempotent: true,
    input: projectsUpdateInput,
    output: z.object({ project: projectEntitySchema }),
  }),
  'deployments.trigger': defineAction({
    name: 'deployments.trigger',
    description: 'Queue a deployment of a project (production branch by default, or any branch/commit as a preview). Returns the QUEUED deployment.',
    scopes: ['orb:deployments:write'],
    async: false,
    idempotent: true,
    input: deploymentsTriggerInput,
    output: deploymentOutput,
  }),
  'deployments.cancel': defineAction({
    name: 'deployments.cancel',
    description: 'Cancel a deployment that is queued, building or being released.',
    scopes: ['orb:deployments:write'],
    async: false,
    idempotent: true,
    input: deploymentIdInput,
    output: deploymentOutput,
  }),
  'deployments.redeploy': defineAction({
    name: 'deployments.redeploy',
    description: 'Rebuild the same commit with the same settings (for example after changing environment variables).',
    scopes: ['orb:deployments:write'],
    async: false,
    idempotent: true,
    input: redeployInput,
    output: deploymentOutput,
  }),
  'deployments.promote': defineAction({
    name: 'deployments.promote',
    description: 'Make a READY deployment the live one. For an older deployment this is an instant rollback. Requires the admin role in Orb, like the dashboard.',
    scopes: ['orb:deployments:write'],
    async: false,
    idempotent: true,
    input: deploymentIdInput,
    output: promoteOutput,
  }),
  'env.set': defineAction({
    name: 'env.set',
    description: 'Create or update environment variables of a project (from a list or a .env file). Values are never echoed back.',
    scopes: ['orb:env:write'],
    async: false,
    idempotent: true,
    input: envSetInput,
    output: envSetOutput,
  }),
  'env.remove': defineAction({
    name: 'env.remove',
    description: 'Remove one environment variable.',
    scopes: ['orb:env:write'],
    async: false,
    idempotent: true,
    input: envRemoveInput,
    output: envRemoveOutput,
  }),
  'domains.add': defineAction({
    name: 'domains.add',
    description: 'Attach a custom domain to a project. The result lists the DNS records the customer has to create.',
    scopes: ['orb:domains:write'],
    async: false,
    idempotent: true,
    input: domainAddInput,
    output: domainOutput,
  }),
  'domains.verify': defineAction({
    name: 'domains.verify',
    description: 'Check the DNS records of a custom domain now.',
    scopes: ['orb:domains:write'],
    async: false,
    idempotent: true,
    input: domainRefInput,
    output: domainVerifyOutput,
  }),
  'domains.remove': defineAction({
    name: 'domains.remove',
    description: 'Detach a custom domain from a project.',
    scopes: ['orb:domains:write'],
    async: false,
    idempotent: true,
    input: domainRefInput,
    output: domainRemoveOutput,
  }),
  'projects.waitForDeployment': defineAction({
    name: 'projects.waitForDeployment',
    description: 'Long-running: resolves when the deployment reaches a terminal status (READY, FAILED, CANCELED, ARCHIVED). Poll the returned operation instead of subscribing to webhooks.',
    scopes: ['orb:deployments:read'],
    async: true,
    idempotent: true,
    input: waitForDeploymentInput,
    output: deploymentOutput,
  }),
} as const satisfies Record<string, ActionDefinition>;

export type ActionName = keyof typeof ACTIONS;
export type ActionInput<N extends ActionName> = z.infer<(typeof ACTIONS)[N]['input']>;
export type ActionOutput<N extends ActionName> = z.infer<(typeof ACTIONS)[N]['output']>;

export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export function getAction(name: string): (typeof ACTIONS)[ActionName] | undefined {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name as ActionName] : undefined;
}
