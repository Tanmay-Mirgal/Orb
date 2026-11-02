import { eq, notificationPreferences } from 'database';
import { notificationPrefsSchema } from 'shared';
import { db } from '@/lib/db';
import { parseBody, route } from '@/server/api';
import { authenticate } from '@/server/context';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, auth.userId)).limit(1);
  return { preferences: row?.categories ?? {} };
});

export const PUT = route(async ({ req }) => {
  const auth = await authenticate(req);
  const preferences = await parseBody(req, notificationPrefsSchema);
  const categories = Object.fromEntries(Object.entries(preferences).filter(([, v]) => v !== undefined)) as Record<string, { email: boolean }>;
  await db
    .insert(notificationPreferences)
    .values({ userId: auth.userId, categories })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { categories, updatedAt: new Date() } });
  return { preferences: categories };
});
