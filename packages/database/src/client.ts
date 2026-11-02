import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface DbOptions {
  /** Max pool size for this process. Keep (instances x max) below Postgres max_connections, or use PgBouncer. */
  max?: number;
  /** Set false when connecting through PgBouncer in transaction-pooling mode. */
  prepare?: boolean;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
  return 'postgresql://orb:password@localhost:5432/orb';
}

export function createDb(url: string = databaseUrl(), options: DbOptions = {}) {
  const sql = postgres(url, {
    max: options.max ?? Number(process.env.DATABASE_POOL_MAX ?? 10),
    prepare: options.prepare ?? process.env.DATABASE_PREPARE !== 'false',
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Database = ReturnType<typeof createDb>['db'];
