import { and, asc, eq, gte, usageHourly } from 'database';
import { db } from '@/lib/db';
import { route } from '@/server/api';
import { authenticate, projectContext } from '@/server/context';

export const dynamic = 'force-dynamic';

const RANGES: Record<string, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

/** Hourly request / bandwidth / status-class rollups written by the edge proxy. */
export const GET = route<{ projectId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  await projectContext(auth, params.projectId, 'project:read');
  const range = new URL(req.url).searchParams.get('range') ?? '24h';
  const hours = RANGES[range] ?? 24;
  const since = new Date(Date.now() - hours * 3_600_000);
  since.setUTCMinutes(0, 0, 0);

  const rows = await db
    .select()
    .from(usageHourly)
    .where(and(eq(usageHourly.projectId, params.projectId), gte(usageHourly.bucket, since)))
    .orderBy(asc(usageHourly.bucket));

  const byBucket = new Map(rows.map((r) => [r.bucket.toISOString(), r]));
  const series = [];
  for (let i = 0; i < hours; i++) {
    const bucket = new Date(since.getTime() + i * 3_600_000);
    const row = byBucket.get(bucket.toISOString());
    series.push({
      bucket: bucket.toISOString(),
      requests: row?.requests ?? 0,
      bytesOut: row?.bytesOut ?? 0,
      errors: row?.status5xx ?? 0,
      avgMs: row && row.requests > 0 ? Math.round(row.durationMsTotal / row.requests) : 0,
    });
  }
  const totals = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      bytesOut: acc.bytesOut + r.bytesOut,
      s2xx: acc.s2xx + r.status2xx,
      s3xx: acc.s3xx + r.status3xx,
      s4xx: acc.s4xx + r.status4xx,
      s5xx: acc.s5xx + r.status5xx,
      durationMs: acc.durationMs + r.durationMsTotal,
    }),
    { requests: 0, bytesOut: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, durationMs: 0 },
  );
  return { range, series, totals: { ...totals, avgMs: totals.requests ? Math.round(totals.durationMs / totals.requests) : 0 } };
});
