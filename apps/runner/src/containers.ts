import Docker from 'dockerode';
import type { Logger, LogStore } from 'core';
import type {
  NodeContainerInfo,
  RunnerRunOncePayload,
  RunnerRunOnceResult,
  RunnerStartPayload,
  RunnerStartResult,
  RunnerStopPayload,
} from 'shared';
import type { RunnerConfig } from './config';

const MANAGED = 'orb.managed';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Docker operations for one runner node: start/stop replicas with hard resource limits, health-gate them, ship logs. */
export class ContainerManager {
  private readonly docker = new Docker();
  private readonly logStreams = new Map<string, NodeJS.ReadableStream>();

  constructor(
    private readonly config: RunnerConfig,
    private readonly logs: LogStore,
    private readonly logger: Logger,
  ) {}

  async ensureNetwork(): Promise<void> {
    const existing = await this.docker.listNetworks({ filters: { name: [this.config.network] } });
    if (existing.some((n) => n.Name === this.config.network)) return;
    // ICC disabled: containers of different tenants must not be able to talk to each other.
    await this.docker.createNetwork({
      Name: this.config.network,
      Driver: 'bridge',
      Options: { 'com.docker.network.bridge.enable_icc': 'false' },
      Labels: { [MANAGED]: 'true' },
    });
  }

  private async pullIfNeeded(image: string): Promise<void> {
    const { registry } = this.config;
    const useRegistry = Boolean(registry.url) && image.startsWith(`${registry.url}/`);
    if (!useRegistry) {
      try {
        await this.docker.getImage(image).inspect();
        return;
      } catch {
        throw new Error(`Image ${image} is not available on node ${this.config.nodeId}. Configure REGISTRY_URL so nodes can pull images.`);
      }
    }
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(
        image,
        { authconfig: registry.username ? { username: registry.username, password: registry.password, serveraddress: registry.url } : undefined },
        (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
          if (err || !stream) return reject(err ?? new Error('No pull stream'));
          this.docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
        },
      );
    });
  }

  private async runtimeEnv(deploymentId: string): Promise<Record<string, string>> {
    const url = `${this.config.controlPlaneUrl}/api/internal/deployments/${deploymentId}/runtime-env`;
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.config.internalToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return ((await res.json()) as { env: Record<string, string> }).env;
        lastError = `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 404) break;
      } catch (err) {
        lastError = String(err);
      }
      await sleep(attempt * 1000);
    }
    throw new Error(`Could not fetch runtime environment from the control plane (${lastError})`);
  }

  private hostConfig(cpuMillis: number, memoryMb: number, port?: number, prebuilt = false): Docker.HostConfig {
    const memory = memoryMb * 1024 * 1024;
    return {
      NanoCpus: cpuMillis * 1_000_000,
      Memory: memory,
      MemorySwap: memory, // no swap: an over-limit container is OOM-killed instead of thrashing the node
      PidsLimit: 512,
      CapDrop: ['ALL'],
      // Images Orb generates run as an unprivileged user. Customer images (nginx, httpd, ...) commonly start as root
      // to chown their data directories and then switch user, which needs these; everything else stays dropped.
      ...(prebuilt ? { CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'SETGID', 'SETUID', 'NET_BIND_SERVICE'] } : {}),
      SecurityOpt: ['no-new-privileges:true'],
      NetworkMode: this.config.network,
      Ulimits: [{ Name: 'nofile', Soft: 65536, Hard: 65536 }],
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      ...(port ? { PortBindings: { [`${port}/tcp`]: [{ HostIp: this.config.bindIp, HostPort: '' }] } } : {}),
    };
  }

  async start(p: RunnerStartPayload): Promise<RunnerStartResult> {
    await this.pullIfNeeded(p.image);
    const userEnv = await this.runtimeEnv(p.deploymentId);
    const platformEnv: Record<string, string> = {
      ...userEnv,
      ORB: '1',
      ORB_DEPLOYMENT_ID: p.deploymentId,
      ORB_PROJECT_ID: p.projectId,
      ORB_ENVIRONMENT: p.environment,
      ORB_URL: p.publicUrl,
      ...(p.commitSha ? { ORB_GIT_COMMIT_SHA: p.commitSha } : {}),
      ...(p.branch ? { ORB_GIT_BRANCH: p.branch } : {}),
      ...(p.type === 'web_service' ? { PORT: String(p.port) } : {}),
    };
    const exposesPort = p.type === 'web_service';
    const container = await this.docker.createContainer({
      name: `orb-${p.instanceId.slice(0, 8)}`,
      Image: p.image,
      Env: Object.entries(platformEnv).map(([k, v]) => `${k}=${v}`),
      Cmd: p.startCommand ? ['sh', '-c', p.startCommand] : undefined,
      Labels: {
        [MANAGED]: 'true',
        'orb.deployment': p.deploymentId,
        'orb.project': p.projectId,
        'orb.instance': p.instanceId,
      },
      ExposedPorts: exposesPort ? { [`${p.port}/tcp`]: {} } : undefined,
      HostConfig: { ...this.hostConfig(p.cpuMillis, p.memoryMb, exposesPort ? p.port : undefined, p.prebuilt), RestartPolicy: { Name: 'unless-stopped' } },
    });

    try {
      await container.start();
      this.attachLogs(container.id, p.deploymentId);
      let hostPort = 0;
      if (exposesPort) {
        hostPort = await this.publishedPort(container, p.port);
        await this.waitHealthy(container, hostPort, p);
      } else {
        await sleep(5000);
        const state = (await container.inspect()).State;
        if (!state.Running) throw new Error(`Container exited immediately (code ${state.ExitCode})`);
      }
      return { containerId: container.id, address: this.config.address, hostPort };
    } catch (err) {
      const tail = await this.tailLogs(container).catch(() => '');
      await this.removeContainer(container.id).catch(() => undefined);
      throw new Error(`${err instanceof Error ? err.message : String(err)}${tail ? `\n--- last container output ---\n${tail}` : ''}`);
    }
  }

  private async publishedPort(container: Docker.Container, port: number): Promise<number> {
    for (let i = 0; i < 20; i++) {
      const info = await container.inspect();
      const binding = info.NetworkSettings.Ports?.[`${port}/tcp`]?.[0]?.HostPort;
      if (binding) return Number(binding);
      await sleep(250);
    }
    throw new Error(`Container did not publish port ${port}`);
  }

  private async waitHealthy(container: Docker.Container, hostPort: number, p: RunnerStartPayload): Promise<void> {
    const host = this.config.bindIp === '0.0.0.0' ? '127.0.0.1' : this.config.bindIp;
    const strict = p.healthCheckPath !== '/';
    const deadline = Date.now() + p.healthCheckTimeoutSec * 1000;
    while (Date.now() < deadline) {
      const state = (await container.inspect()).State;
      if (!state.Running) throw new Error(`Container exited with code ${state.ExitCode}${state.OOMKilled ? ' (out of memory)' : ''} before becoming healthy`);
      try {
        const res = await fetch(`http://${host}:${hostPort}${p.healthCheckPath}`, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
        // The default "/" check only proves the server answers; an explicit health path must succeed.
        if (strict ? res.status < 400 : res.status < 500) return;
      } catch {
        /* not listening yet */
      }
      await sleep(1000);
    }
    throw new Error(`Health check ${p.healthCheckPath} on port ${p.port} did not pass within ${p.healthCheckTimeoutSec}s. Make sure the app listens on $PORT (${p.port}) and on 0.0.0.0.`);
  }

  private async tailLogs(container: Docker.Container): Promise<string> {
    const buf = (await container.logs({ stdout: true, stderr: true, tail: 20 })) as unknown as Buffer;
    // Strip the 8-byte multiplexing headers.
    const out: string[] = [];
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4);
      out.push(buf.subarray(offset + 8, offset + 8 + size).toString('utf8').trimEnd());
      offset += 8 + size;
    }
    return out.join('\n');
  }

  /** Streams container stdout/stderr into the deployment's runtime log. */
  private attachLogs(containerId: string, deploymentId: string, since = Math.floor(Date.now() / 1000) - 1) {
    const container = this.docker.getContainer(containerId);
    container
      .logs({ follow: true, stdout: true, stderr: true, timestamps: true, since })
      .then((stream) => {
        const readable = stream as unknown as NodeJS.ReadableStream;
        this.logStreams.set(containerId, readable);
        let pending: string[] = [];
        const flush = () => {
          if (pending.length === 0) return;
          const batch = pending;
          pending = [];
          this.logs.appendRuntime(deploymentId, batch).catch(() => undefined);
        };
        const timer = setInterval(flush, 500);
        const makeSink = (label: 'out' | 'err') => {
          let rest = '';
          return {
            write: (chunk: Buffer) => {
              rest += chunk.toString('utf8');
              const parts = rest.split('\n');
              rest = parts.pop() ?? '';
              for (const part of parts) if (part.trim()) pending.push(label === 'err' ? `[stderr] ${part}` : part);
              if (pending.length >= 200) flush();
              return true;
            },
          };
        };
        const sinkOut = makeSink('out');
        const sinkErr = makeSink('err');
        this.docker.modem.demuxStream(stream, sinkOut as unknown as NodeJS.WritableStream, sinkErr as unknown as NodeJS.WritableStream);
        const done = () => {
          clearInterval(timer);
          flush();
          this.logStreams.delete(containerId);
        };
        readable.on('end', done);
        readable.on('error', done);
      })
      .catch((err) => this.logger.warn({ containerId, err: String(err) }, 'could not attach to container logs'));
  }

  async stop(p: RunnerStopPayload): Promise<void> {
    const container = this.docker.getContainer(p.containerId);
    try {
      await container.stop({ t: p.gracePeriodSec ?? 30 });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code !== 304 && code !== 404) throw err;
    }
    await this.removeContainer(p.containerId);
  }

  private async removeContainer(containerId: string): Promise<void> {
    this.logStreams.get(containerId)?.removeAllListeners();
    this.logStreams.delete(containerId);
    try {
      await this.docker.getContainer(containerId).remove({ force: true, v: true });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }

  /** One-off container for cron jobs: runs to completion (or until the timeout kills it). */
  async runOnce(p: RunnerRunOncePayload): Promise<RunnerRunOnceResult> {
    await this.pullIfNeeded(p.image);
    const userEnv = await this.runtimeEnv(p.deploymentId);
    const started = Date.now();
    const container = await this.docker.createContainer({
      Image: p.image,
      Env: Object.entries({ ...userEnv, ORB: '1', ORB_PROJECT_ID: p.projectId, ORB_DEPLOYMENT_ID: p.deploymentId, ORB_ENVIRONMENT: p.environment }).map(([k, v]) => `${k}=${v}`),
      Cmd: p.command ? ['sh', '-c', p.command] : undefined,
      Labels: { [MANAGED]: 'true', 'orb.deployment': p.deploymentId, 'orb.project': p.projectId, 'orb.kind': 'cron' },
      HostConfig: this.hostConfig(p.cpuMillis, p.memoryMb, undefined, p.prebuilt),
    });
    try {
      await container.start();
      this.attachLogs(container.id, p.deploymentId);
      const exit = await Promise.race([
        container.wait().then((r) => r.StatusCode),
        sleep(p.timeoutSec * 1000).then(async () => {
          await container.kill().catch(() => undefined);
          return 124;
        }),
      ]);
      await this.logs.appendRuntime(p.deploymentId, [`[cron] finished with exit code ${exit} after ${Math.round((Date.now() - started) / 1000)}s`]);
      return { exitCode: exit, durationMs: Date.now() - started };
    } finally {
      await sleep(1000); // let the last log lines flush
      await this.removeContainer(container.id).catch(() => undefined);
    }
  }

  /** Inventory for the heartbeat. */
  async inventory(): Promise<NodeContainerInfo[]> {
    const list = await this.docker.listContainers({ all: true, filters: { label: [`${MANAGED}=true`] } });
    return list
      .filter((c) => c.Labels['orb.instance'])
      .map((c) => ({
        containerId: c.Id,
        deploymentId: c.Labels['orb.deployment'] ?? '',
        projectId: c.Labels['orb.project'] ?? '',
        instanceId: c.Labels['orb.instance'] ?? '',
        state: c.State,
        hostPort: c.Ports.find((p) => p.PublicPort)?.PublicPort ?? null,
      }));
  }

  /** After a runner restart, resume log shipping for containers that kept running. */
  async reattachAll(): Promise<number> {
    const running = (await this.inventory()).filter((c) => c.state === 'running');
    for (const c of running) this.attachLogs(c.containerId, c.deploymentId);
    return running.length;
  }

  async ping(): Promise<void> {
    await this.docker.ping();
  }

  /** Housekeeping: remove dangling images and stopped managed containers older than a day. */
  async prune(): Promise<void> {
    await this.docker.pruneImages({ filters: { dangling: { true: true } } });
    await this.docker.pruneContainers({ filters: { label: [`${MANAGED}=true`], until: ['24h'] } });
  }
}
