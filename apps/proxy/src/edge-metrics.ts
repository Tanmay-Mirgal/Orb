import type { Redis } from 'core';
import { hourBucket, REDIS_KEYS, statusField, type MetricField } from 'shared';

/**
 * Per-project, per-hour request counters. Requests only touch an in-memory map; a timer flushes the
 * deltas to Redis every few seconds with HINCRBY, and the worker rolls them up into Postgres.
 * Redis load is therefore O(projects), not O(requests).
 */
export class EdgeMetrics {
  private counters = new Map<string, Partial<Record<MetricField, number>>>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly redis: Redis) {}

  start(intervalMs = 5000) {
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref();
  }

  record(projectId: string, status: number, bytesOut: number, durationMs: number): void {
    const key = `${projectId}|${hourBucket()}`;
    let c = this.counters.get(key);
    if (!c) this.counters.set(key, (c = {}));
    c.requests = (c.requests ?? 0) + 1;
    c.bytesOut = (c.bytesOut ?? 0) + bytesOut;
    c.durationMs = (c.durationMs ?? 0) + durationMs;
    const field = statusField(status);
    c[field] = (c[field] ?? 0) + 1;
  }

  async flush(): Promise<void> {
    if (this.counters.size === 0) return;
    const batch = this.counters;
    this.counters = new Map();
    try {
      const pipeline = this.redis.pipeline();
      for (const [member, fields] of batch) {
        const [projectId, bucket] = member.split('|') as [string, string];
        const key = REDIS_KEYS.metricsBucket(projectId, bucket);
        for (const [field, value] of Object.entries(fields)) pipeline.hincrby(key, field, value);
        pipeline.expire(key, 2 * 24 * 3600).sadd(REDIS_KEYS.metricsIndex, member);
      }
      await pipeline.exec();
    } catch {
      // Redis unavailable: put the counts back so they are not lost.
      for (const [member, fields] of batch) {
        const existing = this.counters.get(member) ?? {};
        for (const [field, value] of Object.entries(fields)) {
          existing[field as MetricField] = (existing[field as MetricField] ?? 0) + value;
        }
        this.counters.set(member, existing);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
