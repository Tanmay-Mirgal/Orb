import type { Redis } from 'ioredis';
import { BUILD_LOG_TTL_SECONDS, REDIS_KEYS, RUNTIME_LOG_MAX_LINES } from 'shared';

const MAX_LINE_LENGTH = 8 * 1024;

function clip(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}… [truncated]` : line;
}

/**
 * Log storage.
 *  - Build logs are an append-only Redis list (exact, never trimmed, expires after 7 days; the worker
 *    additionally persists the final log to object storage so it survives a Redis flush).
 *  - Runtime logs are a capped Redis stream: bounded memory per deployment, cursor-based reads.
 */
export class LogStore {
  constructor(private readonly redis: Redis) {}

  async appendBuild(deploymentId: string, lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    const key = REDIS_KEYS.buildLogs(deploymentId);
    await this.redis.multi().rpush(key, ...lines.map(clip)).expire(key, BUILD_LOG_TTL_SECONDS).exec();
  }

  /** Returns lines starting at `from` and the cursor for the next call. */
  async readBuild(deploymentId: string, from = 0): Promise<{ lines: string[]; next: number }> {
    const lines = await this.redis.lrange(REDIS_KEYS.buildLogs(deploymentId), from, -1);
    return { lines, next: from + lines.length };
  }

  async appendRuntime(deploymentId: string, lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    const key = REDIS_KEYS.runtimeLogs(deploymentId);
    const pipeline = this.redis.pipeline();
    for (const line of lines) {
      pipeline.xadd(key, 'MAXLEN', '~', RUNTIME_LOG_MAX_LINES, '*', 'l', clip(line));
    }
    pipeline.expire(key, BUILD_LOG_TTL_SECONDS);
    await pipeline.exec();
  }

  /** `after` is an exclusive stream id; pass `undefined` for the most recent `count` lines. */
  async readRuntime(
    deploymentId: string,
    after?: string,
    count = 500,
  ): Promise<{ entries: Array<{ id: string; line: string }>; last: string | undefined }> {
    const key = REDIS_KEYS.runtimeLogs(deploymentId);
    const raw = after
      ? await this.redis.xrange(key, `(${after}`, '+', 'COUNT', count)
      : (await this.redis.xrevrange(key, '+', '-', 'COUNT', Math.min(count, 200))).reverse();
    const entries = raw.map(([id, fields]) => ({ id, line: fields[1] ?? '' }));
    return { entries, last: entries.length > 0 ? entries[entries.length - 1]!.id : after };
  }
}
