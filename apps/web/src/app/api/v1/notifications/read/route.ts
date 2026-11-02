import { and, eq, inArray, isNull, notifications } from 'database';
import { markNotificationsReadSchema } from 'shared';
import { db } from '@/lib/db';
import { badRequest, parseBody, route } from '@/server/api';
import { authenticate } from '@/server/context';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  const input = await parseBody(req, markNotificationsReadSchema);
  if (!input.all && !input.ids?.length) throw badRequest('Pass `ids` or `all: true`');
  const scope = input.all ? eq(notifications.userId, auth.userId) : and(eq(notifications.userId, auth.userId), inArray(notifications.id, input.ids!));
  await db.update(notifications).set({ readAt: new Date() }).where(and(scope, isNull(notifications.readAt)));
  return { ok: true };
});
