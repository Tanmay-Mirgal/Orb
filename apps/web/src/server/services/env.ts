import { decryptSecret, encryptSecret } from 'core';
import { and, count, eq, environmentVariables, type EnvironmentVariable } from 'database';
import { MAX_ENV_VARS_PER_PROJECT, type EnvVarInput } from 'shared';
import { db } from '@/lib/db';
import { badRequest, notFound } from '../api';

export interface EnvVarView {
  id: string;
  key: string;
  /** `null` for secret variables: the value can be replaced but never read back. */
  value: string | null;
  target: string;
  scope: string;
  isSecret: boolean;
  updatedAt: Date;
}

function toView(row: EnvironmentVariable): EnvVarView {
  return {
    id: row.id,
    key: row.key,
    value: row.isSecret ? null : decryptSecret(row.value, `${row.projectId}:${row.key}`),
    target: row.target,
    scope: row.scope,
    isSecret: row.isSecret,
    updatedAt: row.updatedAt,
  };
}

export async function listEnvVars(projectId: string): Promise<EnvVarView[]> {
  const rows = await db.select().from(environmentVariables).where(eq(environmentVariables.projectId, projectId));
  return rows.map(toView).sort((a, b) => a.key.localeCompare(b.key) || a.target.localeCompare(b.target));
}

/** Upserts on (project, key, target) so pasting a `.env` file twice is idempotent. */
export async function upsertEnvVars(projectId: string, inputs: EnvVarInput[]): Promise<EnvVarView[]> {
  const [existing] = await db.select({ n: count() }).from(environmentVariables).where(eq(environmentVariables.projectId, projectId));
  const known = await db
    .select({ key: environmentVariables.key, target: environmentVariables.target })
    .from(environmentVariables)
    .where(eq(environmentVariables.projectId, projectId));
  const knownSet = new Set(known.map((k) => `${k.key}\0${k.target}`));
  const added = inputs.filter((i) => !knownSet.has(`${i.key}\0${i.target}`)).length;
  if ((existing?.n ?? 0) + added > MAX_ENV_VARS_PER_PROJECT) {
    throw badRequest(`A project can have at most ${MAX_ENV_VARS_PER_PROJECT} environment variables`);
  }

  const now = new Date();
  const saved: EnvironmentVariable[] = [];
  await db.transaction(async (tx) => {
    for (const input of inputs) {
      const [row] = await tx
        .insert(environmentVariables)
        .values({
          projectId,
          key: input.key,
          value: encryptSecret(input.value, `${projectId}:${input.key}`),
          target: input.target,
          scope: input.scope,
          isSecret: input.isSecret,
        })
        .onConflictDoUpdate({
          target: [environmentVariables.projectId, environmentVariables.key, environmentVariables.target],
          set: {
            value: encryptSecret(input.value, `${projectId}:${input.key}`),
            scope: input.scope,
            isSecret: input.isSecret,
            updatedAt: now,
          },
        })
        .returning();
      saved.push(row!);
    }
  });
  return saved.map(toView);
}

export async function deleteEnvVar(projectId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(environmentVariables)
    .where(and(eq(environmentVariables.id, id), eq(environmentVariables.projectId, projectId)))
    .returning({ id: environmentVariables.id });
  if (deleted.length === 0) throw notFound('Environment variable');
}
