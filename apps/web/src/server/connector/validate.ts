import type { ZodType } from 'zod';
import { toJsonSchema, type JsonSchema } from 'shared';

/**
 * Requests are validated against strict schemas (unknown fields are an error). A caller that wants forward
 * compatibility sends `Prefer: unknown-fields=ignore`; unknown fields are then dropped before validation, using the
 * same JSON Schema the manifest publishes.
 */

export function ignoreUnknownFields(req: Request): boolean {
  return (req.headers.get('prefer') ?? '').split(',').some((token) => token.trim().toLowerCase() === 'unknown-fields=ignore');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pickVariant(variants: JsonSchema[], value: Record<string, unknown>): JsonSchema | undefined {
  const objects = variants.filter((v) => v.type === 'object' || v.properties);
  return objects.find((v) => ((v.required as string[] | undefined) ?? []).every((key) => key in value)) ?? objects[0];
}

function strip(schema: JsonSchema | undefined, value: unknown): unknown {
  if (!schema) return value;
  const variants = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  if (variants) {
    if (isObject(value)) {
      const variant = pickVariant(variants, value);
      return variant ? strip(variant, value) : value;
    }
    if (Array.isArray(value)) {
      const variant = variants.find((v) => v.type === 'array');
      return variant ? strip(variant, value) : value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = schema.items as JsonSchema | undefined;
    return items ? value.map((v) => strip(items, v)) : value;
  }
  if (!isObject(value)) return value;
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  if (!properties) return value; // free-form object (metadata, ...)
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) if (key in properties) out[key] = strip(properties[key], v);
  return out;
}

export function parseInput<T>(schema: ZodType<T>, value: unknown, ignoreUnknown: boolean): T {
  return schema.parse(ignoreUnknown ? strip(toJsonSchema(schema, 'input'), value) : value);
}

/** Query string as an object. `orgId` is accepted (and checked against the grant) by the authenticator. */
export function queryObject(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(req.url).searchParams) if (key !== 'orgId') out[key] = value;
  return out;
}

export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  return parseInput(schema, queryObject(req), ignoreUnknownFields(req));
}
