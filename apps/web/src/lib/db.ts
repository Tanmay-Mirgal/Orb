import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://orb:password@localhost:5432/orb');
export const db = drizzle(sql);
