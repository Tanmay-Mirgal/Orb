import { z } from 'zod';
import { MAX_ENV_VALUE_BYTES, PROJECT_TYPES, ROLES } from './constants';
import { INSTANCE_PLANS, PAID_PLAN_IDS } from './plans';
import { NOTIFICATION_CATEGORIES } from './notifications';
import { ENV_KEY_PATTERN, RESERVED_ENV_KEYS } from './env';
import { imageReferenceError } from './image';

/**
 * Request validation. Everything that ends up in a shell, a Dockerfile, a git argument or a DNS name
 * is constrained here (and re-validated by the worker, which never trusts the database blindly).
 */

/** Normalises `./apps//web/` to `apps/web`. Returns null if the path escapes the repository. */
export function normalizeRelativeDir(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim().replace(/\\/g, '/');
  if (raw.startsWith('/')) return null;
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..' || p.includes('\0'))) return null;
  return parts.join('/');
}

const singleLine = z
  .string()
  .max(255)
  .refine((v) => !/[\r\n\0]/.test(v), 'must be a single line');

const relativeDir = z
  .string()
  .max(255)
  .refine((v) => normalizeRelativeDir(v) !== null, 'must be a relative path inside the repository')
  .transform((v) => normalizeRelativeDir(v) ?? '');

export const repoFullName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, 'expected owner/repo');
export const branchName = z
  .string()
  .regex(/^(?!-)(?!.*\.\.)[A-Za-z0-9._/\-]{1,255}$/, 'invalid branch name');

const instancePlan = z.enum(Object.keys(INSTANCE_PLANS) as [string, ...string[]]);
const cronSchedule = z
  .string()
  .max(100)
  .regex(/^\S+(\s+\S+){4}$/, 'expected a 5-field cron expression');

/** `nginx:1.27`, `ghcr.io/owner/app:latest`, `owner/app@sha256:…` */
export const imageRefSchema = z
  .string()
  .trim()
  .max(255)
  .superRefine((value, ctx) => {
    const error = imageReferenceError(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

/** Login for a private registry. The password is stored encrypted and never returned by the API. */
export const registryCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(255).refine((v) => !/[\r\n\0:]/.test(v), 'invalid character in username'),
  password: z.string().min(1).max(2048).refine((v) => !/[\r\n\0]/.test(v), 'invalid character in password or token'),
});
export type RegistryCredentialsInput = z.infer<typeof registryCredentialsSchema>;

export const projectConfigSchema = z.object({
  framework: z.string().max(64).optional(),
  rootDirectory: relativeDir.optional(),
  installCommand: singleLine.optional(),
  buildCommand: singleLine.optional(),
  startCommand: singleLine.optional(),
  outputDirectory: relativeDir.optional(),
  dockerfilePath: relativeDir.optional(),
  /** 0 = auto-detect from the image's EXPOSE (Docker image projects only; the services reject it for Git projects). */
  port: z.number().int().min(0).max(65535).optional(),
  healthCheckPath: z.string().regex(/^\/[^\s]{0,255}$/, 'must start with /').optional(),
  instancePlan: instancePlan.optional(),
  instanceCount: z.number().int().min(1).max(50).optional(),
  cronSchedule: cronSchedule.optional(),
  autoDeploy: z.boolean().optional(),
  previewDeployments: z.boolean().optional(),
});

export const envKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(ENV_KEY_PATTERN, 'letters, digits and underscores only; must not start with a digit')
  .refine((k) => !RESERVED_ENV_KEYS.has(k), 'this key is reserved by the platform');

export const envValueSchema = z
  .string()
  .max(MAX_ENV_VALUE_BYTES)
  .refine((v) => !v.includes('\0'), 'invalid character');

export const envVarInputSchema = z.object({
  key: envKeySchema,
  value: envValueSchema,
  target: z.enum(['all', 'production', 'preview']).default('all'),
  scope: z.enum(['both', 'build', 'runtime']).default('both'),
  isSecret: z.boolean().default(true),
});
export type EnvVarInput = z.infer<typeof envVarInputSchema>;

export const createProjectSchema = projectConfigSchema
  .extend({
    name: z.string().trim().min(2).max(60),
    type: z.enum(PROJECT_TYPES as unknown as [string, ...string[]]),
    /** `git` builds a repository; `image` pulls a prebuilt Docker image from a registry. */
    source: z.enum(['git', 'image']).default('git'),
    repository: z
      .object({
        fullName: repoFullName,
        id: z.number().int().nonnegative(),
        branch: branchName.default('main'),
      })
      .optional(),
    image: imageRefSchema.optional(),
    registry: registryCredentialsSchema.optional(),
    envVars: z.array(envVarInputSchema).max(200).optional(),
    deploy: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'git') {
      if (!value.repository) ctx.addIssue({ code: 'custom', path: ['repository'], message: 'Choose a repository' });
    } else {
      if (!value.image) ctx.addIssue({ code: 'custom', path: ['image'], message: 'Enter a Docker image' });
      if (value.type === 'static') ctx.addIssue({ code: 'custom', path: ['type'], message: 'Static sites are built from a Git repository, not a Docker image' });
    }
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = projectConfigSchema.extend({
  name: z.string().trim().min(2).max(60).optional(),
  branch: branchName.optional(),
  /** Docker image projects only. */
  image: imageRefSchema.optional(),
  /** Docker image projects only: an object sets the registry login, `null` removes it. */
  registry: registryCredentialsSchema.nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createDeploymentSchema = z.object({
  branch: branchName.optional(),
  commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i).optional(),
  /** Build a preview instead of promoting to production. */
  preview: z.boolean().optional(),
});

export const createDomainSchema = z.object({
  domain: z.string().min(3).max(253),
  redirectTo: z.string().min(3).max(253).nullish(),
});

export const updateDomainSchema = z.object({
  redirectTo: z.string().min(3).max(253).nullable(),
});

export const createOrgSchema = z.object({ name: z.string().trim().min(2).max(60) });
export const updateOrgSchema = z.object({ name: z.string().trim().min(2).max(60) });
export const addMemberSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(ROLES as unknown as [string, ...string[]]).default('member'),
});
export const updateMemberSchema = z.object({ role: z.enum(ROLES as unknown as [string, ...string[]]) });

export const createTokenSchema = z.object({
  name: z.string().trim().min(2).max(60),
  expiresInDays: z.number().int().min(1).max(365).nullish(),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['viewer', 'member', 'admin', 'owner']).default('member'),
});

export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(128) });

export const checkoutSchema = z.object({
  plan: z.enum(PAID_PLAN_IDS as unknown as [string, ...string[]]),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

/** What Razorpay Checkout hands back to the browser after a successful payment. */
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().min(32).max(128),
});

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  all: z.boolean().optional(),
});

export const notificationPrefsSchema = z.object(
  Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, z.object({ email: z.boolean() }).optional()])) as Record<
    (typeof NOTIFICATION_CATEGORIES)[number],
    z.ZodOptional<z.ZodObject<{ email: z.ZodBoolean }>>
  >,
);
