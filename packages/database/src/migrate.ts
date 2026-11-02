import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'drizzle');

interface Journal {
  entries: Array<{ tag: string; when: number }>;
}

/**
 * Orb v1 databases were created with `drizzle-kit push`, so they have the baseline tables but no
 * migration history. Mark the baseline migration as applied; every later migration is written to be
 * idempotent and brings both fresh and legacy databases to the same schema.
 */
async function baselineLegacyDatabase(sql: postgres.Sql, folder: string, log: (msg: string) => void) {
  const [history] = await sql<{ present: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
  if (history?.present) return;
  const [legacy] = await sql<{ present: boolean }[]>`select to_regclass('public.projects') is not null as present`;
  if (!legacy?.present) return; // brand-new database: run everything

  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;
  const baseline = journal.entries[0];
  if (!baseline) return;
  const hash = createHash('sha256')
    .update(fs.readFileSync(path.join(folder, `${baseline.tag}.sql`), 'utf8'))
    .digest('hex');
  await sql`create schema if not exists drizzle`;
  await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${baseline.when})`;
  log(`Detected a legacy (pre-migration) database: baselined ${baseline.tag}`);
}

export async function runMigrations(
  url: string,
  folder: string = MIGRATIONS_FOLDER,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await baselineLegacyDatabase(sql, folder, log);
    await migrate(drizzle(sql), { migrationsFolder: folder });
    log('Migrations are up to date');
  } finally {
    await sql.end({ timeout: 5 });
  }
}
