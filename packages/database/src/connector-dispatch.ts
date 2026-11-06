import {
  DISABLE_AFTER_CONSECUTIVE_FAILURES,
  DISABLE_AFTER_FAILING_MS,
  WebhookUrlError,
  decryptConnectorSecret,
  parseWebhookUrl,
  postWebhook,
  retryDelayMs,
  signWebhook,
  webhookHeaders,
  type WebhookUrlPolicy,
} from 'core';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { effectiveScopes, eventMatchesFilter, getEventDefinition } from 'shared';
import type { Database } from './client';
import {
  connectorDeliveries,
  connectorEvents,
  connectorGrants,
  connectorIdempotency,
  connectorCodes,
  connectorOperations,
  connectorUsedRefresh,
  connectorWebhooks,
  memberships,
} from './schema';

/**
 * Webhook delivery for the ecosystem connector. Runs in the worker (any number of them): every claim uses
 * `FOR UPDATE SKIP LOCKED`, so workers cooperate without a coordinator, and a worker that dies mid-delivery loses
 * only a 60 second lease. Delivery is at-least-once; consumers dedupe on the event id.
 */

export interface DispatchOptions {
  now?: () => Date;
  post?: typeof postWebhook;
  policy: WebhookUrlPolicy;
  /** Deliveries claimed per tick. */
  batch?: number;
  concurrency?: number;
}

const LEASE_MS = 60_000;

// --- fan-out -----------------------------------------------------------------------------------------------------------

/**
 * Turns freshly written events into deliveries: one per active endpoint whose filter matches and whose grant may
 * read the event (scopes capped by the user's current role). Filtering happens here, BEFORE anything is queued.
 */
export async function fanOutEvents(db: Database, now: Date = new Date(), limit = 100): Promise<{ events: number; deliveries: number }> {
  return db.transaction(async (tx) => {
    const events = await tx
      .select()
      .from(connectorEvents)
      .where(isNull(connectorEvents.dispatchedAt))
      .orderBy(asc(connectorEvents.seq))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (events.length === 0) return { events: 0, deliveries: 0 };

    const orgIds = [...new Set(events.map((e) => e.orgId))];
    const endpoints = await tx
      .select({ webhook: connectorWebhooks, grant: connectorGrants, role: memberships.role })
      .from(connectorWebhooks)
      .innerJoin(connectorGrants, eq(connectorGrants.id, connectorWebhooks.grantId))
      .innerJoin(memberships, and(eq(memberships.orgId, connectorGrants.orgId), eq(memberships.userId, connectorGrants.userId)))
      .where(and(inArray(connectorWebhooks.orgId, orgIds), eq(connectorWebhooks.status, 'active'), isNull(connectorGrants.revokedAt)));

    const rows: Array<typeof connectorDeliveries.$inferInsert> = [];
    for (const event of events) {
      const definition = getEventDefinition(event.type);
      if (!definition) continue;
      for (const { webhook, grant, role } of endpoints) {
        if (webhook.orgId !== event.orgId || !eventMatchesFilter(event.type, webhook.eventFilter)) continue;
        const scopes = effectiveScopes(role, grant.scopes);
        if (!definition.scopes.every((s) => scopes.includes(s))) continue;
        rows.push({ eventId: event.id, webhookId: webhook.id, status: 'pending', nextAttemptAt: now });
      }
    }
    if (rows.length > 0) await tx.insert(connectorDeliveries).values(rows).onConflictDoNothing();
    await tx.update(connectorEvents).set({ dispatchedAt: now }).where(inArray(connectorEvents.id, events.map((e) => e.id)));
    return { events: events.length, deliveries: rows.length };
  });
}

// --- delivery ----------------------------------------------------------------------------------------------------------

export interface DeliveryStats {
  succeeded: number;
  retried: number;
  abandoned: number;
  disabled: number;
}

async function disableEndpoint(db: Database, webhookId: string, reason: string, now: Date): Promise<void> {
  await db
    .update(connectorWebhooks)
    .set({ status: 'disabled', disabledReason: reason, updatedAt: now })
    .where(and(eq(connectorWebhooks.id, webhookId), eq(connectorWebhooks.status, 'active')));
}

export async function deliverDue(db: Database, options: DispatchOptions): Promise<DeliveryStats> {
  const clock = options.now ?? (() => new Date());
  const post = options.post ?? postWebhook;
  const start = clock();
  const stats: DeliveryStats = { succeeded: 0, retried: 0, abandoned: 0, disabled: 0 };

  // Claim a batch with a lease. A delivery stuck "delivering" past its lease (crashed worker) is picked up again.
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: connectorDeliveries.id })
      .from(connectorDeliveries)
      .where(
        or(
          and(inArray(connectorDeliveries.status, ['pending', 'failed']), lte(connectorDeliveries.nextAttemptAt, start)),
          and(eq(connectorDeliveries.status, 'delivering'), lt(connectorDeliveries.lockedUntil, start)),
        ),
      )
      .orderBy(asc(connectorDeliveries.nextAttemptAt))
      .limit(options.batch ?? 25)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(connectorDeliveries)
      .set({ status: 'delivering', lockedUntil: new Date(start.getTime() + LEASE_MS), attempt: sql`${connectorDeliveries.attempt} + 1`, updatedAt: start })
      .where(inArray(connectorDeliveries.id, due.map((d) => d.id)))
      .returning();
  });

  const processOne = async (delivery: (typeof claimed)[number]) => {
    const [row] = await db
      .select({ webhook: connectorWebhooks, event: connectorEvents })
      .from(connectorDeliveries)
      .innerJoin(connectorWebhooks, eq(connectorWebhooks.id, connectorDeliveries.webhookId))
      .innerJoin(connectorEvents, eq(connectorEvents.id, connectorDeliveries.eventId))
      .where(eq(connectorDeliveries.id, delivery.id))
      .limit(1);
    const finish = (patch: Partial<typeof connectorDeliveries.$inferInsert>) =>
      db.update(connectorDeliveries).set({ ...patch, lockedUntil: null, updatedAt: clock() }).where(eq(connectorDeliveries.id, delivery.id));
    if (!row || row.webhook.status !== 'active') {
      await finish({ status: 'abandoned', nextAttemptAt: null, lastError: 'endpoint is not active' });
      stats.abandoned++;
      return;
    }
    const { webhook, event } = row;

    let secret: string;
    try {
      secret = decryptConnectorSecret(webhook.secretEnc, webhook.id);
    } catch {
      await finish({ status: 'failed', nextAttemptAt: new Date(clock().getTime() + 300_000), lastError: 'signing secret unreadable (check CONNECTOR_ENCRYPTION_KEY)' });
      stats.retried++;
      return;
    }

    const body = JSON.stringify(event.payload);
    const timestamp = Math.floor(clock().getTime() / 1000);
    const headers = webhookHeaders({ type: event.type, deliveryId: delivery.id, timestamp, signature: signWebhook(secret, timestamp, body) });

    let status = 0;
    let excerpt: string | null = null;
    let error: string | null = null;
    let unsafe = false;
    try {
      const url = parseWebhookUrl(webhook.url, options.policy); // re-checked at delivery time
      const res = await post({ url, body, headers, policy: options.policy });
      status = res.status;
      excerpt = res.excerpt;
    } catch (err) {
      unsafe = err instanceof WebhookUrlError || (err as NodeJS.ErrnoException)?.code === 'EBLOCKED';
      error = (err instanceof Error ? err.message : String(err)).slice(0, 250);
    }

    const at = clock();
    if (status >= 200 && status < 300) {
      await finish({ status: 'succeeded', responseCode: status, responseExcerpt: excerpt, lastError: null, nextAttemptAt: null, deliveredAt: at });
      await db
        .update(connectorWebhooks)
        .set({ consecutiveFailures: 0, failingSince: null, lastDeliveryAt: at, lastDeliveryStatus: 'succeeded', lastResponseCode: status, updatedAt: at })
        .where(eq(connectorWebhooks.id, webhook.id));
      stats.succeeded++;
      return;
    }

    // From here on the attempt failed.
    const record = { responseCode: status || null, responseExcerpt: excerpt, lastError: error ?? `HTTP ${status}` };
    const touch = {
      lastDeliveryAt: at,
      lastDeliveryStatus: 'failed',
      lastResponseCode: status || null,
      failingSince: sql`coalesce(${connectorWebhooks.failingSince}, ${at.toISOString()}::timestamp)`,
      updatedAt: at,
    };

    if (status === 410) {
      // 410 Gone: the receiver says it will never come back.
      await finish({ ...record, status: 'abandoned', nextAttemptAt: null });
      await db.update(connectorWebhooks).set(touch).where(eq(connectorWebhooks.id, webhook.id));
      await disableEndpoint(db, webhook.id, 'endpoint_gone', at);
      stats.abandoned++;
      stats.disabled++;
      return;
    }
    if (unsafe) {
      await finish({ ...record, status: 'abandoned', nextAttemptAt: null });
      await db.update(connectorWebhooks).set(touch).where(eq(connectorWebhooks.id, webhook.id));
      await disableEndpoint(db, webhook.id, 'unsafe_url', at);
      stats.abandoned++;
      stats.disabled++;
      return;
    }

    const delay = retryDelayMs(delivery.attempt);
    if (delay === null) {
      await finish({ ...record, status: 'abandoned', nextAttemptAt: null });
      stats.abandoned++;
      // A delivery that used up every retry counts as one failed delivery of the endpoint.
      await db.update(connectorWebhooks).set({ ...touch, consecutiveFailures: sql`${connectorWebhooks.consecutiveFailures} + 1` }).where(eq(connectorWebhooks.id, webhook.id));
    } else {
      await finish({ ...record, status: 'failed', nextAttemptAt: new Date(at.getTime() + delay) });
      await db.update(connectorWebhooks).set(touch).where(eq(connectorWebhooks.id, webhook.id));
      stats.retried++;
    }

    const [after] = await db.select().from(connectorWebhooks).where(eq(connectorWebhooks.id, webhook.id)).limit(1);
    if (after && after.status === 'active') {
      if (after.consecutiveFailures >= DISABLE_AFTER_CONSECUTIVE_FAILURES) {
        await disableEndpoint(db, webhook.id, 'too_many_failures', at);
        stats.disabled++;
      } else if (after.failingSince && at.getTime() - after.failingSince.getTime() >= DISABLE_AFTER_FAILING_MS) {
        await disableEndpoint(db, webhook.id, 'failing_for_3_days', at);
        stats.disabled++;
      }
    }
  };

  const concurrency = Math.max(1, options.concurrency ?? 10);
  for (let i = 0; i < claimed.length; i += concurrency) {
    await Promise.all(claimed.slice(i, i + concurrency).map((d) => processOne(d).catch(() => undefined)));
  }
  return stats;
}

export async function runConnectorDispatch(db: Database, options: DispatchOptions) {
  const fanout = await fanOutEvents(db, (options.now ?? (() => new Date()))());
  const delivery = await deliverDue(db, options);
  return { fanout, delivery };
}

// --- retention ---------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;

/**
 * Housekeeping. Events are kept 14 days (the event log only serves the last 7; deliveries follow their event),
 * operations 7 days, idempotency keys until they expire, codes and rotated refresh hashes for as long as they matter.
 */
export async function runConnectorRetention(db: Database, now: Date = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const count = async (q: Promise<unknown[]>) => (await q).length;
  return {
    events: await count(db.delete(connectorEvents).where(lt(connectorEvents.createdAt, ago(14))).returning({ id: connectorEvents.id })),
    operations: await count(db.delete(connectorOperations).where(lt(connectorOperations.createdAt, ago(7))).returning({ id: connectorOperations.id })),
    idempotency: await count(db.delete(connectorIdempotency).where(lt(connectorIdempotency.expiresAt, now)).returning({ key: connectorIdempotency.key })),
    codes: await count(db.delete(connectorCodes).where(lt(connectorCodes.expiresAt, ago(1))).returning({ hash: connectorCodes.codeHash })),
    usedRefresh: await count(db.delete(connectorUsedRefresh).where(lt(connectorUsedRefresh.usedAt, ago(100))).returning({ hash: connectorUsedRefresh.refreshHash })),
    // Nobody polled these before their deadline: settle them so they do not stay "running" for a week.
    timedOut: await count(
      db
        .update(connectorOperations)
        .set({ status: 'failed', error: { code: 'timeout', message: 'The operation timed out before it was polled' }, finishedAt: now, updatedAt: now })
        .where(and(inArray(connectorOperations.status, ['pending', 'running']), lt(connectorOperations.deadlineAt, now)))
        .returning({ id: connectorOperations.id }),
    ),
  };
}
