import { createHash } from 'node:crypto';
import { and, connectorIdempotency, eq, lte } from 'database';
import { ConnectorError, MAX_IDEMPOTENCY_KEY_LENGTH, cpConflict, cpValidation } from 'shared';
import { db } from '@/lib/db';

/**
 * `Idempotency-Key` for POST actions. `(grant, key)` maps to the request hash and the stored response for 24 hours:
 * same key + same request replays the response, same key + another request is `422 idempotency_conflict`, and a
 * concurrent duplicate is `409 conflict` with `Retry-After: 1`. Failed requests free the key so they can be retried.
 */

export interface StoredResponse {
  status: number;
  body: Record<string, unknown>;
}

const TTL_MS = 24 * 3_600_000;
/** A request that has been "processing" this long belongs to a crashed instance: it may be taken over. */
const STALE_PROCESSING_MS = 2 * 60_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hash of what the caller asked for: the action and its (validated) input, independent of key order. */
export function requestHash(action: string, input: unknown): string {
  return createHash('sha256').update(`${action}\n${canonical(input)}`).digest('hex');
}

export function readIdempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key');
  if (key === null) return null;
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw cpValidation(`Idempotency-Key must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} printable characters`, [{ path: 'Idempotency-Key', message: 'Invalid key' }]);
  }
  return key;
}

export async function withIdempotency(
  grantId: string,
  key: string,
  hash: string,
  run: () => Promise<StoredResponse>,
): Promise<{ result: StoredResponse; replay: boolean }> {
  const claim = async () => {
    const [row] = await db
      .insert(connectorIdempotency)
      .values({ grantId, key, requestHash: hash, expiresAt: new Date(Date.now() + TTL_MS) })
      .onConflictDoNothing()
      .returning({ key: connectorIdempotency.key });
    return Boolean(row);
  };
  const mine = and(eq(connectorIdempotency.grantId, grantId), eq(connectorIdempotency.key, key));

  let owned = await claim();
  if (!owned) {
    const [row] = await db.select().from(connectorIdempotency).where(mine).limit(1);
    const now = Date.now();
    if (!row) {
      owned = await claim(); // released meanwhile
    } else if (row.expiresAt.getTime() <= now) {
      await db.delete(connectorIdempotency).where(and(mine, lte(connectorIdempotency.expiresAt, new Date(now))));
      owned = await claim();
    } else if (row.requestHash !== hash) {
      throw new ConnectorError('idempotency_conflict', 'This Idempotency-Key was already used with a different request');
    } else if (row.state === 'done' && row.status !== null && row.response) {
      return { result: { status: row.status, body: row.response }, replay: true };
    } else if (now - row.createdAt.getTime() > STALE_PROCESSING_MS) {
      const [taken] = await db
        .update(connectorIdempotency)
        .set({ createdAt: new Date(now) })
        .where(and(mine, eq(connectorIdempotency.state, 'processing'), eq(connectorIdempotency.createdAt, row.createdAt)))
        .returning({ key: connectorIdempotency.key });
      owned = Boolean(taken);
    }
  }
  if (!owned) throw cpConflict('A request with this Idempotency-Key is still being processed', { 'Retry-After': '1' });

  try {
    const result = await run();
    if (result.status < 300) {
      await db.update(connectorIdempotency).set({ state: 'done', status: result.status, response: result.body }).where(mine);
    } else {
      await db.delete(connectorIdempotency).where(mine);
    }
    return { result, replay: false };
  } catch (err) {
    await db.delete(connectorIdempotency).where(mine).catch(() => undefined);
    throw err;
  }
}
