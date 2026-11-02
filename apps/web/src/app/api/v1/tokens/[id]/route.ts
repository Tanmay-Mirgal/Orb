import { and, apiTokens, eq } from 'database';
import { db } from '@/lib/db';
import { assertUuid, notFound, route } from '@/server/api';
import { authenticate } from '@/server/context';

export const dynamic = 'force-dynamic';

export const DELETE = route<{ id: string }>(async ({ req, params }) => {
  const auth = await authenticate(req);
  assertUuid(params.id, 'Token');
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, params.id), eq(apiTokens.userId, auth.userId)))
    .returning({ id: apiTokens.id });
  if (revoked.length === 0) throw notFound('Token');
  return { ok: true };
});
