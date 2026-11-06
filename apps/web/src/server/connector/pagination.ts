import { desc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { cpValidation, type Page } from 'shared';

/**
 * Keyset pagination over (created_at, id), newest first. Cursors are opaque, and stable under concurrent inserts:
 * a new row sorts before the cursor and can never shift or repeat rows of later pages. Timestamps are compared at
 * millisecond precision on both sides because the cursor travels as a JavaScript date.
 */

export interface KeysetCursor {
  t: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeCursor = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function decodeCursorObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
}

export function decodeKeyset(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null;
  const { t, id } = decodeCursorObject(raw);
  if (typeof t !== 'string' || typeof id !== 'string' || !UUID.test(id) || new Date(t).toISOString() !== t) {
    throw cpValidation('The cursor is not valid', [{ path: 'cursor', message: 'Use the nextCursor of a previous response' }]);
  }
  return { t, id };
}

const truncated = (col: PgColumn) => sql`date_trunc('milliseconds', ${col})`;

/** `WHERE` fragment selecting the rows after `cursor`. */
export function keysetAfter(createdAt: PgColumn, id: PgColumn, cursor: KeysetCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${truncated(createdAt)}, ${id}) < (${cursor.t}::timestamp, ${cursor.id}::uuid)`;
}

export const keysetOrder = (createdAt: PgColumn, id: PgColumn) => [desc(truncated(createdAt)), desc(id)] as const;

/** Rows were fetched with `limit + 1`: the extra row only tells us there is another page. */
export function toPage<T extends { createdAt: Date; id: string }, U>(rows: T[], limit: number, map: (row: T) => U): Page<U> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(map),
    nextCursor: rows.length > limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id } satisfies KeysetCursor) : null,
  };
}
