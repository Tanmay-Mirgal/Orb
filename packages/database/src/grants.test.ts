import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import type { Database } from './client';
import { MIGRATIONS_FOLDER } from './migrate';
import { applyPlanGrants } from './plan-grants';

const OWNER = 'tanmaymirgal26@gmail.com';

async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { client, db: db as unknown as Database };
}

async function addUser(client: PGlite, id: string, email: string, verified: boolean) {
  await client.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, $4, now(), now())`, [id, id, email, verified]);
}

async function addOrg(client: PGlite, orgId: string, ownerId: string, role = 'owner') {
  await client.query(`insert into organizations (id, name, slug) values ($1::uuid, $2, $2)`, [orgId, `org-${orgId.slice(-4)}`]);
  await client.query(`insert into memberships (org_id, user_id, role) values ($1::uuid, $2, $3)`, [orgId, ownerId, role]);
}

const planOf = async (client: PGlite, orgId: string) =>
  (await client.query<{ plan: string; plan_source: string; plan_expires_at: Date | null }>(`select plan, plan_source, plan_expires_at from organizations where id = $1::uuid`, [orgId])).rows[0]!;

describe('owner plan grant', () => {
  it('is seeded by the migration for five years', async () => {
    const { client } = await freshDb();
    const { rows } = await client.query<{ plan: string; years: number }>(
      `select plan, extract(year from age(expires_at, now()))::int as years from plan_grants where email = $1`,
      [OWNER],
    );
    expect(rows[0]?.plan).toBe('team');
    expect(rows[0]?.years).toBeGreaterThanOrEqual(4); // 4 years and 364 days, depending on when the clock ticks
  });

  it('upgrades the teams a verified owner has, and only those', async () => {
    const { client, db } = await freshDb();
    await addUser(client, 'owner', OWNER, true);
    await addUser(client, 'other', 'someone@example.com', true);
    await addOrg(client, '00000000-0000-0000-0000-000000000001', 'owner');
    await addOrg(client, '00000000-0000-0000-0000-000000000002', 'other');
    await client.query(`insert into memberships (org_id, user_id, role) values ('00000000-0000-0000-0000-000000000002', 'owner', 'member')`);

    const applied = await applyPlanGrants(db, 'owner');
    expect(applied.map((a) => a.orgId)).toEqual(['00000000-0000-0000-0000-000000000001']);

    const mine = await planOf(client, '00000000-0000-0000-0000-000000000001');
    expect(mine).toMatchObject({ plan: 'team', plan_source: 'grant' });
    expect(mine.plan_expires_at!.getTime()).toBeGreaterThan(Date.now() + 4 * 365 * 86_400_000);
    // A team the person merely belongs to is not theirs to upgrade.
    expect((await planOf(client, '00000000-0000-0000-0000-000000000002')).plan).toBe('free');
    // Idempotent.
    expect(await applyPlanGrants(db, 'owner')).toHaveLength(0);
  });

  it('ignores unverified addresses and people without a grant', async () => {
    const { client, db } = await freshDb();
    await addUser(client, 'spoof', OWNER.replace('26', '27'), true);
    await addUser(client, 'unverified', OWNER, false);
    await addOrg(client, '00000000-0000-0000-0000-000000000003', 'spoof');
    await addOrg(client, '00000000-0000-0000-0000-000000000004', 'unverified');
    expect(await applyPlanGrants(db, 'spoof')).toHaveLength(0);
    expect(await applyPlanGrants(db, 'unverified')).toHaveLength(0);
    expect((await planOf(client, '00000000-0000-0000-0000-000000000004')).plan).toBe('free');
  });

  it('does not downgrade a team that already has a higher plan', async () => {
    const { client, db } = await freshDb();
    await addUser(client, 'owner', OWNER, true);
    await addOrg(client, '00000000-0000-0000-0000-000000000005', 'owner');
    await client.query(`update organizations set plan = 'team', plan_source = 'paid' where id = '00000000-0000-0000-0000-000000000005'`);
    expect(await applyPlanGrants(db, 'owner')).toHaveLength(0);
    expect((await planOf(client, '00000000-0000-0000-0000-000000000005')).plan_source).toBe('paid');
  });
});
