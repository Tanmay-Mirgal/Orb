import { config as loadDotenv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

let loaded = false;

/**
 * Loads the monorepo-root `.env` (walking up from the working directory) once.
 * Real environment variables always win, so containers/CI can override anything.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (value === undefined) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  return parsed;
}

export function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** Platform-wide settings derived from the environment; identical for every service. */
export function platformConfig() {
  const baseDomain = (env('BASE_DOMAIN') ?? env('NEXT_PUBLIC_BASE_DOMAIN') ?? 'localhost').toLowerCase();
  const scheme = envBool('PUBLIC_HTTPS', baseDomain !== 'localhost') ? 'https' : 'http';
  return {
    baseDomain,
    scheme,
    /** Where DNS CNAME records for custom domains must point. */
    cnameTarget: (env('CNAME_TARGET') ?? `cname.${baseDomain}`).toLowerCase(),
    /** IPs for apex (A record) custom domains. */
    platformIps: (env('PLATFORM_IPS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    dashboardUrl: env('NEXT_PUBLIC_APP_URL') ?? env('BETTER_AUTH_URL') ?? 'http://localhost:3000',
  };
}

export function deploymentUrl(subdomainOrSlug: string): string {
  const { baseDomain, scheme } = platformConfig();
  const port = env('PUBLIC_PORT');
  const suffix = port && baseDomain === 'localhost' ? `:${port}` : '';
  return `${scheme}://${subdomainOrSlug}.${baseDomain}${suffix}`;
}
