import { and, count, desc, eq, isNull, notifications } from 'database';
import { db } from '@/lib/db';
import { route } from '@/server/api';
import { authenticate } from '@/server/context';

export const dynamic = 'force-dynamic';

/** The caller's inbox (newest first) plus the unread counter shown on the bell. */
export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 20) || 20, 50);
  const [rows, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        category: notifications.category,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, auth.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, auth.userId), isNull(notifications.readAt))),
  ]);
  return { notifications: rows, unread: unread[0]?.n ?? 0 };
});
