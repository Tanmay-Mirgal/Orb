import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import type { Database } from './client';
import { MIGRATIONS_FOLDER } from './migrate';
import { notify, orgMemberIds } from './notify';

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  for (const [id, email] of [['u1', 'a@example.com'], ['u2', 'b@example.com'], ['u3', 'c@example.com']] as const) {
    await client.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())`, [id, id, email]);
  }
  await client.query(`insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000aa'::uuid, 'Acme', 'acme')`);
  for (const [uid, role] of [['u1', 'owner'], ['u2', 'admin'], ['u3', 'member']] as const) {
    await client.query(`insert into memberships (org_id, user_id, role) values ('00000000-0000-0000-0000-0000000000aa'::uuid, $1, $2)`, [uid, role]);
  }
  return { client, db: db as unknown as Database };
}

describe('notify', () => {
  it('writes one in-app row per real recipient and ignores duplicates, nulls and unknown ids', async () => {
    const { client, db } = await setup();
    const result = await notify(db, {
      userIds: ['u1', 'u1', 'ghost', null, undefined, 'u2'],
      category: 'deployments',
      type: 'deployment.failed',
      title: 'api failed to deploy',
      href: '/dashboard/projects/api',
    });
    expect(result).toEqual({ inApp: 2, emailed: 0 });
    const { rows } = await client.query<{ user_id: string; title: string; read_at: Date | null }>(`select user_id, title, read_at from notifications order by user_id`);
    expect(rows.map((r) => r.user_id)).toEqual(['u1', 'u2']);
    expect(rows.every((r) => r.title === 'api failed to deploy' && r.read_at === null)).toBe(true);
  });

  it('does nothing for an empty audience and never throws on bad input', async () => {
    const { client, db } = await setup();
    expect(await notify(db, { userIds: [], category: 'team', type: 'x', title: 't' })).toEqual({ inApp: 0, emailed: 0 });
    // A title longer than the column is truncated, not an error.
    const long = 'x'.repeat(400);
    expect((await notify(db, { userIds: ['u3'], category: 'team', type: 'x', title: long })).inApp).toBe(1);
    const { rows } = await client.query<{ n: number }>(`select length(title) as n from notifications`);
    expect(rows[0]!.n).toBe(255);
  });

  it('resolves team members by role', async () => {
    const { db } = await setup();
    const org = '00000000-0000-0000-0000-0000000000aa';
    expect((await orgMemberIds(db, org, ['owner', 'admin'])).sort()).toEqual(['u1', 'u2']);
    expect(await orgMemberIds(db, org, ['viewer'])).toEqual([]);
  });
});
