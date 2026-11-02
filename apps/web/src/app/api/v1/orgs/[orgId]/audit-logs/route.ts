import { auditLogs, desc, eq } from 'database';
import { db } from '@/lib/db';
import { route } from '@/server/api';
import { authenticate, orgContext, requirePermission } from '@/server/context';

export const dynamic = 'force-dynamic';

export const GET = route<{ orgId: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req, params.orgId);
  requirePermission(role, 'audit:read');
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 50) || 50, 200);
  const logs = await db.select().from(auditLogs).where(eq(auditLogs.orgId, org.id)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  return { logs };
});
