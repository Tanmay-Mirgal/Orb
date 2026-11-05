import { z } from 'zod';
import { annotate, dateTime } from './common';

/** Webhook endpoint management (`/webhooks`). */

export const webhookCreateSchema = z.strictObject({
  url: annotate(z.string().url().max(2048), 'URL', 'https URL that receives events. Private, loopback and link-local addresses are rejected.', ['https://hub.example.com/hooks/orb']),
  events: annotate(z.array(z.string().min(1).max(64)).min(1).max(50), 'Events', 'Exact types or `prefix.*`, e.g. ["deployment.*"].', [['deployment.*', 'project.created']]),
  description: annotate(z.string().max(255).optional(), 'Description'),
});
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;

export const webhookPatchSchema = z.strictObject({
  url: z.string().url().max(2048).optional(),
  events: z.array(z.string().min(1).max(64)).min(1).max(50).optional(),
  description: z.string().max(255).nullable().optional(),
  /** `active` re-enables a disabled endpoint (its failure counters are reset). */
  status: z.enum(['active', 'disabled']).optional(),
});
export type WebhookPatchInput = z.infer<typeof webhookPatchSchema>;

export const webhookEntitySchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  description: z.string().nullable(),
  status: z.enum(['active', 'disabled']),
  disabledReason: z.string().nullable(),
  consecutiveFailures: z.number(),
  lastDelivery: z.object({ at: z.string(), status: z.string(), responseCode: z.number().nullable() }).nullable(),
  createdAt: dateTime('Created'),
  updatedAt: dateTime('Updated'),
});
export type WebhookEntity = z.infer<typeof webhookEntitySchema>;

export const webhookCreatedSchema = webhookEntitySchema.extend({
  secret: annotate(z.string(), 'Signing secret', 'whsec_… Returned once. Use it to verify X-CP-Signature.'),
});

export const deliveryEntitySchema = z.object({
  id: z.string().meta({ title: 'Delivery id (X-CP-Delivery)' }),
  eventId: z.string(),
  eventType: z.string(),
  status: z.enum(['pending', 'delivering', 'succeeded', 'failed', 'abandoned']),
  attempts: z.number(),
  nextAttemptAt: z.string().nullable(),
  responseCode: z.number().nullable(),
  responseExcerpt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: dateTime('Created'),
  deliveredAt: z.string().nullable(),
});
export type DeliveryEntity = z.infer<typeof deliveryEntitySchema>;

export const eventsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
  types: annotate(z.string().max(500).optional(), 'Types filter', 'Comma-separated exact types or prefix.* patterns.'),
});
