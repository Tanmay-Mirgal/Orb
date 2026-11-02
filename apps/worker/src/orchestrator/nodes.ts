import { instances, inArray, sql } from 'database';
import { REDIS_KEYS, type NodeHeartbeat } from 'shared';
import type { WorkerContext } from '../context';

/** Nodes whose heartbeat key (TTL 20 s) is still present. Expired nodes are dropped from the registry set. */
export async function listLiveNodes(ctx: WorkerContext): Promise<NodeHeartbeat[]> {
  const ids = await ctx.redis.smembers(REDIS_KEYS.nodes);
  if (ids.length === 0) return [];
  const blobs = await ctx.redis.mget(ids.map((id) => REDIS_KEYS.node(id)));
  const live: NodeHeartbeat[] = [];
  const stale: string[] = [];
  ids.forEach((id, i) => {
    const blob = blobs[i];
    if (!blob) stale.push(id);
    else {
      try {
        live.push(JSON.parse(blob) as NodeHeartbeat);
      } catch {
        stale.push(id);
      }
    }
  });
  if (stale.length > 0) await ctx.redis.srem(REDIS_KEYS.nodes, ...stale);
  return live;
}

export const ACTIVE_INSTANCE_STATUSES = ['STARTING', 'RUNNING', 'UNHEALTHY'];

/**
 * Bin-packing placement with anti-affinity: replicas of one deployment go to different nodes whenever
 * capacity allows, and the node with the most free memory is preferred (spreads load, avoids hot nodes).
 * Capacity accounting comes from the instances table, the source of truth for what is scheduled.
 */
export async function pickNodes(
  ctx: WorkerContext,
  count: number,
  need: { cpuMillis: number; memoryMb: number },
): Promise<string[]> {
  const nodes = (await listLiveNodes(ctx)).filter((n) => !n.draining);
  if (nodes.length === 0) throw new Error('No runner nodes are online. Start at least one `runner` agent.');

  const usage = await ctx.db
    .select({
      nodeId: instances.nodeId,
      cpu: sql<number>`coalesce(sum(${instances.cpuMillis}), 0)::int`,
      mem: sql<number>`coalesce(sum(${instances.memoryMb}), 0)::int`,
    })
    .from(instances)
    .where(inArray(instances.status, ACTIVE_INSTANCE_STATUSES))
    .groupBy(instances.nodeId);
  const used = new Map(usage.map((u) => [u.nodeId, { cpu: Number(u.cpu), mem: Number(u.mem) }]));

  const free = new Map(
    nodes.map((n) => {
      const u = used.get(n.id) ?? { cpu: 0, mem: 0 };
      return [n.id, { cpu: n.capacity.cpuMillis - u.cpu, mem: n.capacity.memoryMb - u.mem }];
    }),
  );
  const chosen: string[] = [];
  for (let i = 0; i < count; i++) {
    const fits = [...free.entries()].filter(([, f]) => f.cpu >= need.cpuMillis && f.mem >= need.memoryMb);
    if (fits.length === 0) {
      throw new Error(`Not enough free capacity in the cluster for ${count} instance(s) of ${need.cpuMillis}m CPU / ${need.memoryMb} MB`);
    }
    fits.sort((a, b) => {
      const repeatA = chosen.includes(a[0]) ? 1 : 0;
      const repeatB = chosen.includes(b[0]) ? 1 : 0;
      return repeatA - repeatB || b[1].mem - a[1].mem;
    });
    const [nodeId, f] = fits[0]!;
    chosen.push(nodeId);
    f.cpu -= need.cpuMillis;
    f.mem -= need.memoryMb;
  }
  return chosen;
}
