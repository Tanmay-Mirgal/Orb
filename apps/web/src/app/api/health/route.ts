import { NextResponse } from 'next/server';
import { sql } from 'database';
import { db } from '@/lib/db';
import { getRedis } from '@/server/infra';

export const dynamic = 'force-dynamic';

/** Readiness probe for load balancers / orchestrators: verifies Postgres and Redis. */
export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;
  try {
    await db.execute(sql`select 1`);
    checks.postgres = 'ok';
  } catch (e) {
    ok = false;
    checks.postgres = (e as Error).message;
  }
  try {
    await getRedis().ping();
    checks.redis = 'ok';
  } catch (e) {
    ok = false;
    checks.redis = (e as Error).message;
  }
  return NextResponse.json({ status: ok ? 'ok' : 'unavailable', checks }, { status: ok ? 200 : 503 });
}
