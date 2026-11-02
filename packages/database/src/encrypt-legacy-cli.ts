import { encryptSecret, isEncrypted, loadEnv } from 'core';
import { createDb } from './client';
import { environmentVariables } from './schema';
import { eq } from 'drizzle-orm';

/**
 * Orb v1 stored environment variable values in plaintext. This one-off job encrypts every remaining
 * plaintext row (AES-256-GCM, bound to projectId:key). Safe to run repeatedly.
 */
async function main() {
  loadEnv();
  const { db, sql } = createDb(undefined, { max: 2 });
  try {
    const rows = await db.select().from(environmentVariables);
    let converted = 0;
    for (const row of rows) {
      if (isEncrypted(row.value)) continue;
      await db
        .update(environmentVariables)
        .set({ value: encryptSecret(row.value, `${row.projectId}:${row.key}`), updatedAt: new Date() })
        .where(eq(environmentVariables.id, row.id));
      converted++;
    }
    console.log(`Encrypted ${converted} of ${rows.length} environment variable(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
