import { actorOf } from '@/server/actor';
import { z } from 'zod';
import { envVarInputSchema, parseDotenv } from 'shared';
import { badRequest, parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, projectContext } from '@/server/context';
import { listEnvVars, upsertEnvVars } from '@/server/services/env';

export const dynamic = 'force-dynamic';

export const GET = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  await projectContext(auth, params.projectId, 'env:read');
  return { envVars: await listEnvVars(params.projectId) };
});

const bodySchema = z.object({
  envVars: z.array(envVarInputSchema).max(200).optional(),
  /** Raw `.env` text; parsed server-side with the same rules as the dashboard's paste import. */
  dotenv: z.string().max(100_000).optional(),
  target: z.enum(['all', 'production', 'preview']).default('all'),
  scope: z.enum(['both', 'build', 'runtime']).default('both'),
  isSecret: z.boolean().default(true),
});

/** Creates or updates variables (idempotent on key + target). Changes apply to the next deployment. */
export const PUT = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const ctx = await projectContext(auth, params.projectId, 'env:write');
  const body = await parseBody(req, bodySchema);

  const inputs = [...(body.envVars ?? [])];
  let skipped: string[] = [];
  if (body.dotenv) {
    const parsed = parseDotenv(body.dotenv);
    skipped = parsed.skipped;
    for (const v of parsed.vars) {
      inputs.push({ key: v.key, value: v.value, target: body.target, scope: body.scope, isSecret: body.isSecret });
    }
  }
  if (inputs.length === 0) throw badRequest('No variables provided');

  const saved = await upsertEnvVars(params.projectId, inputs, actorOf(auth));
  await audit(auth, {
    orgId: ctx.org.id,
    action: 'env.upsert',
    targetType: 'project',
    targetId: params.projectId,
    metadata: { keys: saved.map((s) => s.key) },
  });
  return { envVars: saved, skipped };
});
