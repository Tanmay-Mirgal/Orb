import { randomUUID } from 'node:crypto';
import { and, asc, connectorDeliveries, connectorEvents, connectorWebhooks, count, eq, inArray, sql, type ConnectorWebhook } from 'database';
import { assertPublicWebhookUrl, connectorConfig, encryptConnectorSecret, generateWebhookSecret, WebhookUrlError, type WebhookUrlPolicy } from 'core';
import {
  CONNECTOR_LIMITS,
  EVENTS,
  cpConflict,
  cpNotFound,
  cpValidation,
  eventMatchesFilter,
  eventsQuerySchema,
  isValidEventFilter,
  pageQuerySchema,
  webhookCreateSchema,
  webhookPatchSchema,
  type DeliveryEntity,
  type WebhookEntity,
} from 'shared';
import { db } from '@/lib/db';
import { auditConnectorCall } from './audit';
import { connectAuthed, type ConnectorAuth } from './auth';
import { ConnectResponse, readBodyText } from './http';
import { decodeCursorObject, decodeKeyset, encodeCursor, keysetAfter, keysetOrder, toPage } from './pagination';
import { ignoreUnknownFields, parseInput, parseQuery } from './validate';

/** Webhook endpoints owned by a grant, their delivery log, and the polling fallback `GET /events`. */

const SCOPE = 'orb:webhooks:manage' as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function webhookPolicy(): WebhookUrlPolicy {
  return { production: process.env.NODE_ENV === 'production', allowPrivate: connectorConfig().allowPrivateWebhooks };
}

function toWebhook(row: ConnectorWebhook): WebhookEntity {
  return {
    id: row.id,
    url: row.url,
    events: row.eventFilter,
    description: row.description,
    status: row.status === 'active' ? 'active' : 'disabled',
    disabledReason: row.disabledReason,
    consecutiveFailures: row.consecutiveFailures,
    lastDelivery: row.lastDeliveryAt ? { at: row.lastDeliveryAt.toISOString(), status: row.lastDeliveryStatus ?? 'unknown', responseCode: row.lastResponseCode } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readBody(req: Request): Promise<unknown> {
  const text = await readBodyText(req);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw cpValidation('Request body must be valid JSON');
  }
}

/** SSRF rules at registration: https, no private/loopback/link-local/metadata addresses, DNS resolved and checked. */
async function checkUrl(url: string): Promise<void> {
  try {
    await assertPublicWebhookUrl(url, webhookPolicy());
  } catch (err) {
    if (err instanceof WebhookUrlError) throw cpValidation(err.message, [{ path: 'url', message: err.message }]);
    throw err;
  }
}

function checkFilters(filters: string[]): void {
  const bad = filters.map((f, i) => ({ f, i })).filter(({ f }) => !isValidEventFilter(f));
  if (bad.length > 0) {
    throw cpValidation(`Unknown event type: ${bad[0]!.f}`, bad.map(({ f, i }) => ({ path: `events.${i}`, message: `"${f}" is not an event type or a prefix.* pattern` })));
  }
}

/** A webhook of THIS grant, or 404 (another grant's endpoint is none of your business). */
async function owned(auth: ConnectorAuth, id: string): Promise<ConnectorWebhook> {
  if (!UUID.test(id)) throw cpNotFound('Webhook');
  const [row] = await db
    .select()
    .from(connectorWebhooks)
    .where(and(eq(connectorWebhooks.id, id), eq(connectorWebhooks.grantId, auth.connector.grantId)))
    .limit(1);
  if (!row) throw cpNotFound('Webhook');
  return row;
}

export const webhooksCreate = connectAuthed({ scope: SCOPE }, async ({ req, auth }) => {
  const input = parseInput(webhookCreateSchema, await readBody(req), ignoreUnknownFields(req));
  checkFilters(input.events);
  const [existing] = await db.select({ n: count() }).from(connectorWebhooks).where(eq(connectorWebhooks.grantId, auth.connector.grantId));
  if ((existing?.n ?? 0) >= CONNECTOR_LIMITS.webhookMaxEndpoints) {
    throw cpConflict(`A connection can have at most ${CONNECTOR_LIMITS.webhookMaxEndpoints} webhook endpoints`);
  }
  await checkUrl(input.url);

  const id = randomUUID();
  const secret = generateWebhookSecret();
  const [row] = await db
    .insert(connectorWebhooks)
    .values({
      id,
      grantId: auth.connector.grantId,
      orgId: auth.org.id,
      url: input.url,
      eventFilter: [...new Set(input.events)],
      description: input.description ?? null,
      secretEnc: encryptConnectorSecret(secret, id),
    })
    .returning();
  await auditConnectorCall(auth, 'webhooks.create', { orgId: auth.org.id, action: 'webhook.create', targetType: 'webhook', targetId: id });
  // The signing secret is shown here and never again.
  return new ConnectResponse({ ...toWebhook(row!), secret }, { status: 201 });
});

export const webhooksList = connectAuthed({ scope: SCOPE }, async ({ req, auth }) => {
  parseQuery(pageQuerySchema, req);
  const rows = await db.select().from(connectorWebhooks).where(eq(connectorWebhooks.grantId, auth.connector.grantId)).orderBy(asc(connectorWebhooks.createdAt));
  return { items: rows.map(toWebhook), nextCursor: null };
});

export const webhooksGet = connectAuthed<{ id: string }>({ scope: SCOPE }, async ({ auth, params }) => toWebhook(await owned(auth, params.id)));

export const webhooksPatch = connectAuthed<{ id: string }>({ scope: SCOPE }, async ({ req, auth, params }) => {
  const row = await owned(auth, params.id);
  const input = parseInput(webhookPatchSchema, await readBody(req), ignoreUnknownFields(req));
  if (input.events) checkFilters(input.events);
  if (input.url && input.url !== row.url) await checkUrl(input.url);
  const patch: Partial<typeof connectorWebhooks.$inferInsert> = { updatedAt: new Date() };
  if (input.url) patch.url = input.url;
  if (input.events) patch.eventFilter = [...new Set(input.events)];
  if (input.description !== undefined) patch.description = input.description;
  if (input.status === 'active') {
    // Re-enabling starts clean: the URL is re-checked and the failure counters reset.
    await checkUrl(input.url ?? row.url);
    Object.assign(patch, { status: 'active', disabledReason: null, consecutiveFailures: 0, failingSince: null });
  } else if (input.status === 'disabled') {
    Object.assign(patch, { status: 'disabled', disabledReason: 'manual' });
  }
  const [updated] = await db.update(connectorWebhooks).set(patch).where(eq(connectorWebhooks.id, row.id)).returning();
  await auditConnectorCall(auth, 'webhooks.update', { orgId: auth.org.id, action: 'webhook.update', targetType: 'webhook', targetId: row.id });
  return toWebhook(updated!);
});

export const webhooksDelete = connectAuthed<{ id: string }>({ scope: SCOPE }, async ({ auth, params }) => {
  const row = await owned(auth, params.id);
  await db.delete(connectorWebhooks).where(eq(connectorWebhooks.id, row.id));
  await auditConnectorCall(auth, 'webhooks.delete', { orgId: auth.org.id, action: 'webhook.delete', targetType: 'webhook', targetId: row.id });
  return { id: row.id, deleted: true };
});

export const webhookDeliveries = connectAuthed<{ id: string }>({ scope: SCOPE }, async ({ req, auth, params }) => {
  const row = await owned(auth, params.id);
  const query = parseQuery(pageQuerySchema, req);
  const after = keysetAfter(connectorDeliveries.createdAt, connectorDeliveries.id, decodeKeyset(query.cursor));
  const rows = await db
    .select({ delivery: connectorDeliveries, type: connectorEvents.type })
    .from(connectorDeliveries)
    .innerJoin(connectorEvents, eq(connectorEvents.id, connectorDeliveries.eventId))
    .where(and(eq(connectorDeliveries.webhookId, row.id), after))
    .orderBy(...keysetOrder(connectorDeliveries.createdAt, connectorDeliveries.id))
    .limit(query.limit + 1);
  return toPage(
    rows.map((r) => ({ ...r, createdAt: r.delivery.createdAt, id: r.delivery.id })),
    query.limit,
    ({ delivery, type }): DeliveryEntity => ({
      id: delivery.id,
      eventId: delivery.eventId,
      eventType: type,
      status: delivery.status as DeliveryEntity['status'],
      attempts: delivery.attempt,
      nextAttemptAt: delivery.nextAttemptAt ? delivery.nextAttemptAt.toISOString() : null,
      responseCode: delivery.responseCode,
      responseExcerpt: delivery.responseExcerpt,
      lastError: delivery.lastError,
      createdAt: delivery.createdAt.toISOString(),
      deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
    }),
  );
});

export const webhookRedeliver = connectAuthed<{ id: string; deliveryId: string }>({ scope: SCOPE }, async ({ auth, params }) => {
  const webhook = await owned(auth, params.id);
  if (!UUID.test(params.deliveryId)) throw cpNotFound('Delivery');
  const [delivery] = await db
    .select()
    .from(connectorDeliveries)
    .where(and(eq(connectorDeliveries.id, params.deliveryId), eq(connectorDeliveries.webhookId, webhook.id)))
    .limit(1);
  if (!delivery) throw cpNotFound('Delivery');
  if (webhook.status !== 'active') throw cpConflict('The endpoint is disabled. Re-enable it with PATCH /webhooks/{id} first.');
  if (delivery.status === 'delivering') throw cpConflict('This delivery is being attempted right now');
  // A fresh attempt group: the dispatcher sends it again with the same X-CP-Delivery id.
  await db
    .update(connectorDeliveries)
    .set({ status: 'pending', attempt: 0, nextAttemptAt: new Date(), lastError: null, responseCode: null, responseExcerpt: null, lockedUntil: null, updatedAt: new Date() })
    .where(eq(connectorDeliveries.id, delivery.id));
  await auditConnectorCall(auth, 'webhooks.redeliver', { orgId: auth.org.id, action: 'webhook.redeliver', targetType: 'delivery', targetId: delivery.id });
  return new ConnectResponse({ id: delivery.id, status: 'pending' }, { status: 202 });
});

/**
 * `GET /events`: the team's event log in commit order, for healing missed webhooks.
 * Rows are only served once their transaction can no longer be in flight (`tx_id < xmin`), ordered by (tx_id, seq),
 * so a reader that resumes from a cursor never skips an event that committed late. Retained 7 days.
 */
export const eventsList = connectAuthed({ scope: 'orb:events:read' }, async ({ req, auth }) => {
  const query = parseQuery(eventsQuerySchema, req);
  const filters = query.types ? query.types.split(',').map((t) => t.trim()).filter(Boolean) : [];
  checkFilters(filters);
  // Only events the grant may read (scopes capped by the user's current role).
  const allowed = EVENTS.filter((e) => e.scopes.every((s) => auth.scopes.includes(s)) && (filters.length === 0 || eventMatchesFilter(e.type, filters))).map((e) => e.type);
  if (allowed.length === 0) return { items: [], nextCursor: query.cursor ?? null };

  let position: { x: string; s: number } | null = null;
  if (query.cursor) {
    const { x, s } = decodeCursorObject(query.cursor);
    if (typeof x !== 'string' || !/^\d{1,20}$/.test(x) || typeof s !== 'number' || !Number.isSafeInteger(s)) {
      throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
    }
    position = { x, s };
  }
  const rows = await db
    .select({ payload: connectorEvents.payload, seq: connectorEvents.seq, tx: sql<string>`${connectorEvents.txId}::text` })
    .from(connectorEvents)
    .where(
      and(
        eq(connectorEvents.orgId, auth.org.id),
        inArray(connectorEvents.type, allowed),
        sql`${connectorEvents.createdAt} > ${new Date(Date.now() - 7 * 86_400_000).toISOString()}::timestamp`,
        sql`${connectorEvents.txId} < pg_snapshot_xmin(pg_current_snapshot())`,
        position ? sql`(${connectorEvents.txId}, ${connectorEvents.seq}) > (${position.x}::xid8, ${position.s})` : undefined,
      ),
    )
    .orderBy(asc(sql`${connectorEvents.txId}`), asc(connectorEvents.seq))
    .limit(query.limit);
  const last = rows[rows.length - 1];
  // Always resumable: with nothing new the caller's own cursor comes back.
  return { items: rows.map((r) => r.payload), nextCursor: last ? encodeCursor({ x: last.tx, s: last.seq }) : (query.cursor ?? null) };
});

