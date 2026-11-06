import { decryptSecret, encryptSecret } from 'core';
import { and, count, emitEnvEvent, eq, environmentVariables, withOutbox, type ActorSpec, type EnvironmentVariable, type Executor } from 'database';
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
export async function upsertEnvVars(projectId: string, inputs: EnvVarInput[], actor: ActorSpec = { kind: 'user' }): Promise<EnvVarView[]> {
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
    // One `env.updated` per target, keys only; written in the same transaction as the change.
    const byTarget = new Map<string, string[]>();
    for (const row of saved) byTarget.set(row.target, [...(byTarget.get(row.target) ?? []), row.key]);
    for (const [target, keys] of byTarget) {
      await emitEnvEvent(tx as unknown as Executor, projectId, keys, target as 'all' | 'production' | 'preview', 'set', actor);
    }
  });
  return saved.map(toView);
}

export async function deleteEnvVar(projectId: string, id: string, actor: ActorSpec = { kind: 'user' }): Promise<void> {
  const deleted = await withOutbox(db, async (tx) => {
    const rows = await tx
      .delete(environmentVariables)
      .where(and(eq(environmentVariables.id, id), eq(environmentVariables.projectId, projectId)))
      .returning({ id: environmentVariables.id, key: environmentVariables.key, target: environmentVariables.target });
    if (rows[0]) await emitEnvEvent(tx, projectId, [rows[0].key], rows[0].target as 'all' | 'production' | 'preview', 'removed', actor);
    return rows;
  });
  if (deleted.length === 0) throw notFound('Environment variable');
}
