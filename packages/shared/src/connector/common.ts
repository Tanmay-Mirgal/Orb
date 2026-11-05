import { z } from 'zod';

/** Shared building blocks of the CP1 registry: correlation fields, pagination, annotated primitives. */

export const CONNECTOR_SERVICE = 'orb';
export const CONNECTOR_DISPLAY_NAME = 'Orb';
export const CONNECTOR_VERSION = '1.0.0';
export const CONNECTOR_API_VERSION = 'cp1';
export const CONNECTOR_BASE_PATH = '/api/connect/v1';

export const CONNECTOR_LIMITS = {
  requestsPerMinute: 120,
  maxBodyBytes: 1_048_576,
  webhookMaxEndpoints: 5,
} as const;

export const MAX_METADATA_BYTES = 2048;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/** Typed helper so every schema carries `title`, `description` and (optionally) `examples` into the JSON Schema. */
export function annotate<T extends z.ZodType>(schema: T, title: string, description?: string, examples?: unknown[]): T {
  return schema.meta({ title, ...(description ? { description } : {}), ...(examples ? { examples } : {}) }) as T;
}

export const dateTime = (title = 'Timestamp', description?: string) =>
  annotate(z.string().meta({ format: 'date-time' }), title, description, ['2026-01-01T10:00:00.000Z']);

/** `{ hubProjectId?, hubRunId?, hubStepId? }`: how the Hub correlates events with its workflow runs. */
export const externalRefSchema = annotate(
  z.strictObject({
    hubProjectId: z.string().max(64).optional().meta({ title: 'Hub project id' }),
    hubRunId: z.string().max(64).optional().meta({ title: 'Hub run id' }),
    hubStepId: z.string().max(64).optional().meta({ title: 'Hub step id' }),
  }),
  'External reference',
  'Caller-defined correlation ids. Stored on the entity and echoed in every event about it (and its children).',
  [{ hubProjectId: 'prj_123', hubRunId: 'run_456', hubStepId: 'step_deploy' }],
);
export type ExternalRef = z.infer<typeof externalRefSchema>;

/** Free-form caller metadata, at most 2 KB when serialised. */
export const metadataSchema = annotate(
  z
    .record(z.string().max(64), z.unknown())
    .refine((v) => JSON.stringify(v).length <= MAX_METADATA_BYTES, `metadata must be at most ${MAX_METADATA_BYTES} bytes`),
  'Metadata',
  `Free-form object (at most ${MAX_METADATA_BYTES} bytes when serialised) stored with the entity and returned as is.`,
  [{ source: 'hub' }],
);
export type Metadata = z.infer<typeof metadataSchema>;

export const uuidSchema = (title: string, description?: string) => annotate(z.string().uuid(), title, description, ['3f6c7a0e-5f0b-4d0e-9c9e-2f4d9b1a7c11']);

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().meta({ title: 'Next cursor', description: 'Pass as `cursor` to get the next page; null at the end.' }),
  });
}

/** `?limit=&cursor=` of every list resource. */
export const pageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50).meta({ title: 'Limit', description: 'Items per page (default 50, max 200).' }),
  cursor: z.string().max(512).optional().meta({ title: 'Cursor', description: 'Opaque cursor from a previous response.' }),
});

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type ActorKind = 'user' | 'system' | 'connector';
export interface Actor {
  id: string | null;
  name: string | null;
  kind: ActorKind;
}
