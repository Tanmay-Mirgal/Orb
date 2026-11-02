import { decryptSecret } from 'core';
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { environmentVariables } from './schema';

export interface ResolvedEnv {
  vars: Record<string, string>;
  /** Values of variables flagged secret, for log redaction. */
  secretValues: string[];
}

/**
 * Collapses a project's variables for one deployment:
 *  - `scope` selects build-time or runtime variables (`both` applies to either);
 *  - a variable targeted at the deployment's environment beats one targeted at `all`.
 * Values are decrypted here; callers must never persist or log the result.
 */
export async function resolveEnvVars(
  db: Database,
  projectId: string,
  options: { environment: 'production' | 'preview'; scope: 'build' | 'runtime' },
): Promise<ResolvedEnv> {
  const rows = await db.select().from(environmentVariables).where(eq(environmentVariables.projectId, projectId));
  const chosen = new Map<string, { rank: number; row: (typeof rows)[number] }>();
  for (const row of rows) {
    if (row.scope !== 'both' && row.scope !== options.scope) continue;
    const rank = row.target === options.environment ? 2 : row.target === 'all' ? 1 : 0;
    if (rank === 0) continue;
    const existing = chosen.get(row.key);
    if (!existing || rank > existing.rank) chosen.set(row.key, { rank, row });
  }
  const vars: Record<string, string> = {};
  const secretValues: string[] = [];
  for (const { row } of chosen.values()) {
    const value = decryptSecret(row.value, `${row.projectId}:${row.key}`);
    vars[row.key] = value;
    if (row.isSecret) secretValues.push(value);
  }
  return { vars, secretValues };
}
