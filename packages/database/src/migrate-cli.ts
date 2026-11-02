import { loadEnv } from 'core';
import { databaseUrl } from './client';
import { runMigrations } from './migrate';

loadEnv();
runMigrations(databaseUrl()).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
