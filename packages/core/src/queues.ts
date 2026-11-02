import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUES, type BuildJob, type ReleaseJob, type RunnerCommand } from 'shared';
import { bullConnection } from './redis';

const retention: JobsOptions = {
  removeOnComplete: { age: 24 * 3600, count: 2000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

export type BuildQueue = Queue<BuildJob>;
export type ReleaseQueue = Queue<ReleaseJob>;

export function createBuildQueue(redis: Redis): BuildQueue {
  // A failed build is a user problem, not a transient one: never auto-retry.
  return new Queue<BuildJob>(QUEUES.build, {
    connection: bullConnection(redis),
    defaultJobOptions: { ...retention, attempts: 1 },
  });
}

export function createReleaseQueue(redis: Redis): ReleaseQueue {
  return new Queue<ReleaseJob>(QUEUES.release, {
    connection: bullConnection(redis),
    defaultJobOptions: { ...retention, attempts: 1 },
  });
}

export function createMaintenanceQueue(redis: Redis): Queue {
  return new Queue(QUEUES.maintenance, { connection: bullConnection(redis), defaultJobOptions: retention });
}

/** `jobId` makes enqueueing idempotent: the same deployment can never be built twice concurrently. */
export function enqueueBuild(queue: BuildQueue, deploymentId: string) {
  return queue.add('build', { deploymentId }, { jobId: `build-${deploymentId}` });
}

export function enqueueRelease(queue: ReleaseQueue, deploymentId: string, promote: boolean) {
  return queue.add('release', { deploymentId, promote }, { jobId: `release-${deploymentId}-${Date.now()}` });
}

/**
 * Request/reply over BullMQ: the scheduler sends a command to one specific runner node
 * (queue per node) and awaits the result the runner returns from its job handler.
 */
export class RunnerClient {
  private readonly queues = new Map<string, Queue>();
  private readonly events = new Map<string, QueueEvents>();

  constructor(private readonly redis: Redis) {}

  private queueFor(nodeId: string): Queue {
    let queue = this.queues.get(nodeId);
    if (!queue) {
      queue = new Queue(QUEUES.runner(nodeId), {
        connection: bullConnection(this.redis),
        defaultJobOptions: { removeOnComplete: { age: 3600, count: 500 }, removeOnFail: { age: 86400, count: 500 }, attempts: 1 },
      });
      this.queues.set(nodeId, queue);
    }
    return queue;
  }

  private eventsFor(nodeId: string): QueueEvents {
    let events = this.events.get(nodeId);
    if (!events) {
      events = new QueueEvents(QUEUES.runner(nodeId), { connection: bullConnection(this.redis.duplicate()) });
      this.events.set(nodeId, events);
    }
    return events;
  }

  async call<TResult>(nodeId: string, command: RunnerCommand, payload: unknown, timeoutMs: number): Promise<TResult> {
    const events = this.eventsFor(nodeId);
    await events.waitUntilReady();
    const job = await this.queueFor(nodeId).add(command, payload);
    return (await job.waitUntilFinished(events, timeoutMs)) as TResult;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.events.values()].map((e) => e.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
