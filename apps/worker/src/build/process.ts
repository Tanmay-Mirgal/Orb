import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Runs a command, streaming stdout+stderr line by line. Resolves with the exit code.
 * Timeout / abort send SIGTERM, then SIGKILL after 10 s, and resolve with code 124 / 130.
 */
export function runCommand(command: string, args: string[], options: RunOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let finished = false;
    let reason: 'timeout' | 'abort' | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    const terminate = (why: 'timeout' | 'abort') => {
      if (finished || reason) return;
      reason = why;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    };
    const timeout = options.timeoutMs ? setTimeout(() => terminate('timeout'), options.timeoutMs) : undefined;
    const onAbort = () => terminate('abort');
    if (options.signal?.aborted) onAbort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const attach = (stream: NodeJS.ReadableStream) => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        rest += chunk;
        const parts = rest.split(/\r\n|\n|\r/);
        rest = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(ANSI, '').trimEnd();
          if (line) options.onLine(line);
        }
      });
      stream.on('end', () => {
        const line = rest.replace(ANSI, '').trimEnd();
        if (line) options.onLine(line);
      });
    };
    attach(child.stdout);
    attach(child.stderr);

    child.on('error', (err) => {
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });
    child.on('close', (code) => {
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(reason === 'timeout' ? 124 : reason === 'abort' ? 130 : (code ?? 1));
    });
  });
}
