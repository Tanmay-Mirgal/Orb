import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate';

const sqlFile = (name: string) => fs.readFileSync(path.join(MIGRATIONS_FOLDER, name), 'utf8');
const statements = (name: string) =>
  sqlFile(name)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

describe('migrations', () => {
  it('build the full schema on a fresh database', async () => {
    const client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const expected of [
      'organizations', 'memberships', 'projects', 'deployments', 'instances',
      'domains', 'environment_variables', 'api_tokens', 'audit_logs', 'usage_hourly',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('upgrade a legacy v1 database (with data) and are safe to re-run', async () => {
    const client = new PGlite();
    // Legacy state = baseline migration + the ad-hoc columns/tables v1 added through `drizzle-kit push`.
    for (const stmt of statements('0000_easy_sway.sql')) await client.exec(stmt);
    await client.exec(`
      ALTER TABLE projects ADD COLUMN slug varchar(255) UNIQUE;
      ALTER TABLE domains ADD COLUMN status varchar(50) NOT NULL DEFAULT 'pending';
    `);
    await client.exec(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES ('u1', 'Ada', 'ada@example.com', true, now(), now());
      INSERT INTO projects (id, name, "userId", framework, slug)
        VALUES ('11111111-1111-1111-1111-111111111111', 'Blog', 'u1', 'Next.js', NULL),
               ('22222222-2222-2222-2222-222222222222', 'Docs', 'u1', 'React.js', 'docs-abc123');
      INSERT INTO deployments (id, "projectId", status)
        VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'SUCCESS');
      INSERT INTO domains (domain, "projectId", status)
        VALUES ('blog.example.com', '11111111-1111-1111-1111-111111111111', 'active'),
               ('docs.example.com', '22222222-2222-2222-2222-222222222222', 'pending');
      INSERT INTO environment_variables ("projectId", key, value, created_at) VALUES
        ('11111111-1111-1111-1111-111111111111', 'API_KEY', 'old', now() - interval '1 day'),
        ('11111111-1111-1111-1111-111111111111', 'API_KEY', 'new', now());
    `);

    const upgrade = async () => {
      for (const stmt of statements('0001_upgrade_v2.sql')) await client.exec(stmt);
    };
    await upgrade();
    await upgrade(); // idempotent: a second run must be a no-op

    const projects = (
      await client.query<{ name: string; slug: string; type: string; org_id: string }>(
        `select name, slug, type, org_id from projects order by name`,
      )
    ).rows;
    expect(projects.map((p) => p.type)).toEqual(['web_service', 'static']);
    expect(projects.every((p) => p.org_id && p.slug)).toBe(true);
    expect(projects[0]!.slug).toMatch(/^blog-[a-f0-9]{6}$/);

    const members = await client.query(`select * from memberships where user_id = 'u1' and role = 'owner'`);
    expect(members.rows).toHaveLength(1);

    const deployment = await client.query<{ status: string }>(`select status from deployments`);
    expect(deployment.rows[0]!.status).toBe('READY');

    const domains = (
      await client.query<{ domain: string; verified_at: string | null; verification_token: string }>(
        `select domain, verified_at, verification_token from domains order by domain`,
      )
    ).rows;
    expect(domains[0]!.verified_at).not.toBeNull(); // grandfathered active domain
    expect(domains[1]!.verified_at).toBeNull();
    expect(domains.every((d) => d.verification_token.length === 32)).toBe(true);

    const env = await client.query<{ value: string }>(`select value from environment_variables`);
    expect(env.rows).toEqual([{ value: 'new' }]); // legacy duplicate removed, newest kept
  });
});
