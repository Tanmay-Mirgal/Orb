import { createLogger, sendEmail, type EmailContent } from 'core';
import { emailEnabled, type NotificationCategory, type NotificationPrefs, type Role } from 'shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './client';
import { memberships, notificationPreferences, notifications, users } from './schema';

const logger = createLogger('notify');

export interface Recipient {
  id: string;
  name: string;
  email: string;
}

export interface NotifyInput {
  userIds: Array<string | null | undefined>;
  category: NotificationCategory;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  orgId?: string | null;
  /** Builds the e-mail for one recipient. Omit for an in-app-only notification. */
  email?: (recipient: Recipient) => EmailContent;
}

/**
 * The single entry point for telling a user something: always writes to their in-app inbox, and also sends an
 * e-mail when the category's preference allows it (billing and security are always e-mailed).
 * Best effort by design — it never throws, so a notification problem cannot fail a deployment or a payment.
 */
export async function notify(db: Database, input: NotifyInput): Promise<{ inApp: number; emailed: number }> {
  const ids = [...new Set(input.userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return { inApp: 0, emailed: 0 };
  try {
    const recipients = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids));
    if (recipients.length === 0) return { inApp: 0, emailed: 0 };

    await db.insert(notifications).values(
      recipients.map((r) => ({
        userId: r.id,
        orgId: input.orgId ?? null,
        category: input.category,
        type: input.type,
        title: input.title.slice(0, 255),
        body: input.body ?? null,
        href: input.href?.slice(0, 512) ?? null,
      })),
    );

    let emailed = 0;
    if (input.email) {
      const prefRows = await db
        .select({ userId: notificationPreferences.userId, categories: notificationPreferences.categories })
        .from(notificationPreferences)
        .where(inArray(notificationPreferences.userId, recipients.map((r) => r.id)));
      const prefs = new Map(prefRows.map((p) => [p.userId, p.categories as NotificationPrefs]));
      const build = input.email;
      const results = await Promise.allSettled(
        recipients
          .filter((r) => r.email && emailEnabled(input.category, prefs.get(r.id)))
          .map(async (r) => {
            const content = build(r);
            const result = await sendEmail({ to: r.email, ...content });
            if (result.sent) emailed++;
          }),
      );
      for (const r of results) if (r.status === 'rejected') logger.warn({ err: String(r.reason) }, 'notification e-mail failed');
    }
    return { inApp: recipients.length, emailed };
  } catch (err) {
    logger.error({ type: input.type, err: err instanceof Error ? err.message : String(err) }, 'notify failed');
    return { inApp: 0, emailed: 0 };
  }
}

/** User ids of an organisation's members holding one of `roles`. */
export async function orgMemberIds(db: Database, orgId: string, roles: readonly Role[]): Promise<string[]> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.role, [...roles])));
  return rows.map((r) => r.userId);
}
