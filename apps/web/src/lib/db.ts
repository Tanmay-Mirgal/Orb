import { createDb } from 'database';

// Reuse one pool across hot reloads in development and across route modules in production.
const globalForDb = globalThis as unknown as { __orbDb?: ReturnType<typeof createDb> };

const instance = globalForDb.__orbDb ?? createDb();
if (process.env.NODE_ENV !== 'production') globalForDb.__orbDb = instance;

export const db = instance.db;
export const pg = instance.sql;
