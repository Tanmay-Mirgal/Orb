import { spawn } from 'node:child_process';

/** Runs a command feeding `stdin` (used for `docker login --password-stdin` so the password never hits argv). */
export function runProcess(command: string, args: string[], stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} failed: ${stderr.trim()}`))));
    child.stdin.end(stdin);
  });
}
