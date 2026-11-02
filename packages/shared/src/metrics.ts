/** Edge analytics are rolled up per project per hour. */

export function hourBucket(date: Date = new Date()): string {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

export const METRIC_FIELDS = ['requests', 'bytesOut', 's2xx', 's3xx', 's4xx', 's5xx', 'durationMs'] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export function statusField(status: number): MetricField {
  if (status >= 500) return 's5xx';
  if (status >= 400) return 's4xx';
  if (status >= 300) return 's3xx';
  return 's2xx';
}
