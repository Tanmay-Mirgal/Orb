/** Environment variable helpers shared by the dashboard (paste import) and the build pipeline. */

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Keys injected by the platform; users may not override them. */
export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
  'PORT',
  'ORB',
  'ORB_DEPLOYMENT_ID',
  'ORB_PROJECT_ID',
  'ORB_ENVIRONMENT',
  'ORB_GIT_COMMIT_SHA',
  'ORB_GIT_BRANCH',
  'ORB_URL',
  'PATH',
  'HOME',
  'HOSTNAME',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'NODE_OPTIONS_ORB',
]);

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key) && key.length <= 128 && !RESERVED_ENV_KEYS.has(key);
}

/**
 * Parses pasted `.env` content. Supports `export KEY=value`, comments, single/double quotes
 * and values containing `=`. Invalid keys are skipped and returned in `skipped`.
 */
export function parseDotenv(text: string): { vars: Array<{ key: string; value: string }>; skipped: string[] } {
  const vars: Array<{ key: string; value: string }> = [];
  const skipped: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      // strip trailing inline comment for unquoted values
      value = value.replace(/\s+#.*$/, '');
    }
    if (!isValidEnvKey(key)) {
      skipped.push(key);
      continue;
    }
    vars.push({ key, value });
  }
  return { vars, skipped };
}

/** POSIX single-quote escaping, safe for `export KEY='...'` lines. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Renders a file that can be sourced by `sh` (`set -a; . file; set +a`). Invalid keys are dropped. */
export function toShellEnvFile(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .filter(([key]) => ENV_KEY_PATTERN.test(key))
      .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
      .join('\n') + '\n'
  );
}

/** Replaces every secret value found in `line` with `***`. Ignores very short values to avoid noise. */
export function createRedactor(secrets: Iterable<string>): (line: string) => string {
  const needles = [...new Set([...secrets].filter((s) => s.length >= 6))].sort((a, b) => b.length - a.length);
  if (needles.length === 0) return (line) => line;
  return (line) => {
    let out = line;
    for (const needle of needles) {
      if (out.includes(needle)) out = out.split(needle).join('***');
    }
    return out;
  };
}
