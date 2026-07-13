import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const sql = globalForDb.conn ?? postgres(process.env.DATABASE_URL || 'postgresql://orb:password@localhost:5432/orb');
if (process.env.NODE_ENV !== 'production') globalForDb.conn = sql;

export const db = drizzle(sql);
