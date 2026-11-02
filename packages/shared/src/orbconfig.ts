import { z } from 'zod';

/**
 * `orb.json` — optional per-project routing configuration for static deployments
 * (the equivalent of Vercel's vercel.json / Netlify's _redirects + _headers).
 * Parsed by the build worker, embedded into the deployment manifest, evaluated by the edge proxy.
 *
 * Path pattern syntax (intentionally small, no user-controlled regex => no ReDoS):
 *   /blog/:slug      one path segment, available as :slug in the destination
 *   /docs/*          anything (including slashes), available as :splat in the destination
 */

const pathPattern = z.string().min(1).max(512).startsWith('/');

export const orbConfigSchema = z.object({
  cleanUrls: z.boolean().optional(),
  trailingSlash: z.boolean().optional(),
  /** Serve index.html for unknown paths (single-page apps). */
  spa: z.boolean().optional(),
  redirects: z
    .array(
      z.object({
        source: pathPattern,
        destination: z.string().min(1).max(2048),
        permanent: z.boolean().optional(),
      }),
    )
    .max(100)
    .optional(),
  rewrites: z
    .array(z.object({ source: pathPattern, destination: pathPattern }))
    .max(100)
    .optional(),
  headers: z
    .array(
      z.object({
        source: pathPattern,
        headers: z
          .array(
            z.object({
              key: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
              value: z.string().max(2048).regex(/^[^\r\n]*$/),
            }),
          )
          .max(30),
      }),
    )
    .max(50)
    .optional(),
});
export type OrbConfig = z.infer<typeof orbConfigSchema>;

export function parseOrbConfig(raw: string): { config: OrbConfig; error?: undefined } | { config?: undefined; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { error: `orb.json is not valid JSON: ${(e as Error).message}` };
  }
  const parsed = orbConfigSchema.safeParse(json);
  if (!parsed.success) {
    return { error: `orb.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }
  return { config: parsed.data };
}

export interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];
}

const compiledCache = new Map<string, CompiledPattern>();

/** Compiles a path pattern; wildcard/param count is capped to keep matching linear. */
export function compilePattern(pattern: string): CompiledPattern {
  const cached = compiledCache.get(pattern);
  if (cached) return cached;
  const paramNames: string[] = [];
  let wildcards = 0;
  let source = '^';
  const tokens = pattern.split(/(:[A-Za-z_][A-Za-z0-9_]*|\*)/);
  for (const token of tokens) {
    if (token === '*') {
      if (++wildcards > 3) throw new Error(`pattern ${pattern} has too many wildcards`);
      paramNames.push('splat');
      source += '(.*)';
    } else if (token.startsWith(':')) {
      if (++wildcards > 3) throw new Error(`pattern ${pattern} has too many parameters`);
      paramNames.push(token.slice(1));
      source += '([^/]+)';
    } else {
      source += token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  source += '/?$';
  const compiled = { regex: new RegExp(source), paramNames };
  if (compiledCache.size > 2000) compiledCache.clear();
  compiledCache.set(pattern, compiled);
  return compiled;
}

export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  let compiled: CompiledPattern;
  try {
    compiled = compilePattern(pattern);
  } catch {
    return null;
  }
  const match = compiled.regex.exec(path);
  if (!match) return null;
  const params: Record<string, string> = {};
  compiled.paramNames.forEach((name, i) => {
    params[name] = match[i + 1] ?? '';
  });
  return params;
}

export function applyParams(destination: string, params: Record<string, string>): string {
  return destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) =>
    name in params ? params[name]! : whole,
  );
}

export type RouteDecision =
  | { type: 'redirect'; location: string; status: 301 | 308 }
  | { type: 'rewrite'; path: string }
  | { type: 'pass' };

/** Evaluates redirects then rewrites for a request path. First match wins. */
export function evaluateRoutes(config: OrbConfig | undefined, path: string): RouteDecision {
  if (!config) return { type: 'pass' };
  for (const rule of config.redirects ?? []) {
    const params = matchPattern(rule.source, path);
    if (params) {
      return {
        type: 'redirect',
        location: applyParams(rule.destination, params),
        status: rule.permanent === false ? 308 : 301,
      };
    }
  }
  for (const rule of config.rewrites ?? []) {
    const params = matchPattern(rule.source, path);
    if (params) return { type: 'rewrite', path: applyParams(rule.destination, params) };
  }
  return { type: 'pass' };
}

export function headersForPath(config: OrbConfig | undefined, path: string): Array<[string, string]> {
  if (!config?.headers) return [];
  const out: Array<[string, string]> = [];
  for (const rule of config.headers) {
    if (matchPattern(rule.source, path)) {
      for (const h of rule.headers) out.push([h.key, h.value]);
    }
  }
  return out;
}
