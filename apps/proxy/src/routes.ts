import { and, deployments, domains, eq, instances, isNotNull, projects, type Database } from 'database';
import { isValidDnsLabel, type RouteInvalidation } from 'shared';
import { LRUCache } from 'lru-cache';
import type { ProxyConfig } from './config';

export interface Endpoint {
  id: string;
  address: string;
  port: number;
}

export type Route =
  | { kind: 'redirect'; location: string; status: 308 }
  | { kind: 'static'; projectId: string; deploymentId: string }
  | { kind: 'service'; projectId: string; deploymentId: string; endpoints: Endpoint[] }
  | { kind: 'none'; reason: 'not_found' | 'no_deployment' | 'no_instances' }
  /** A free-plan service that was stopped for being idle: the edge starts it and shows a waiting page. */
  | { kind: 'sleeping'; projectId: string; deploymentId: string };

export function normalizeHost(raw: string | undefined): string {
  return (raw ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * host -> what to serve. Results are cached per host and dropped instantly through Redis pub/sub
 * (`orb:routes:invalidate`) whenever a deployment is promoted, an instance changes or a domain is edited,
 * so a rollback or a custom-domain change is live within milliseconds on every edge node.
 */
export class RouteResolver {
  private readonly cache: LRUCache<string, Route>;
  private readonly hostsByProject = new Map<string, Set<string>>();
  private readonly inflight = new Map<string, Promise<Route>>();

  constructor(
    private readonly db: Database,
    private readonly config: ProxyConfig,
  ) {
    this.cache = new LRUCache<string, Route>({ max: 20_000 });
  }

  invalidate(message: RouteInvalidation): void {
    if (message.all || !message.projectId) {
      this.cache.clear();
      this.hostsByProject.clear();
      return;
    }
    const hosts = this.hostsByProject.get(message.projectId);
    if (hosts) for (const host of hosts) this.cache.delete(host);
    this.hostsByProject.delete(message.projectId);
    // Negative entries have no project: they expire quickly instead.
  }

  async resolve(rawHost: string | undefined): Promise<Route> {
    const host = normalizeHost(rawHost);
    if (!host) return { kind: 'none', reason: 'not_found' };
    const cached = this.cache.get(host);
    if (cached) return cached;
    // Coalesce concurrent lookups for the same cold host (thundering herd).
    let pending = this.inflight.get(host);
    if (!pending) {
      pending = this.lookup(host).finally(() => this.inflight.delete(host));
      this.inflight.set(host, pending);
    }
    return pending;
  }

  private trackHost(projectId: string, host: string) {
    let set = this.hostsByProject.get(projectId);
    if (!set) this.hostsByProject.set(projectId, (set = new Set()));
    set.add(host);
  }

  private remember(host: string, route: Route, projectId?: string) {
    const ttl = route.kind === 'none' || route.kind === 'redirect' ? this.config.negativeTtlMs : this.config.routeTtlMs;
    this.cache.set(host, route, { ttl });
    if (projectId) this.trackHost(projectId, host);
  }

  private async lookup(host: string): Promise<Route> {
    const { db } = this;
    const { baseDomain } = this.config;
    let projectId: string | null = null;
    let deploymentId: string | null = null;

    if (host.endsWith(`.${baseDomain}`)) {
      const label = host.slice(0, -(baseDomain.length + 1));
      if (!isValidDnsLabel(label)) return this.none(host, 'not_found');
      const [project] = await db
        .select({ id: projects.id, current: projects.currentDeploymentId })
        .from(projects)
        .where(eq(projects.slug, label))
        .limit(1);
      if (project) {
        projectId = project.id;
        deploymentId = project.current;
      } else {
        const [deployment] = await db
          .select({ id: deployments.id, projectId: deployments.projectId })
          .from(deployments)
          .where(eq(deployments.subdomain, label))
          .limit(1);
        if (deployment) {
          projectId = deployment.projectId;
          deploymentId = deployment.id;
        }
      }
    } else {
      const [domain] = await db
        .select({ projectId: domains.projectId, redirectTo: domains.redirectTo, current: projects.currentDeploymentId })
        .from(domains)
        .innerJoin(projects, eq(projects.id, domains.projectId))
        .where(and(eq(domains.domain, host), isNotNull(domains.verifiedAt)))
        .limit(1);
      if (domain) {
        if (domain.redirectTo) {
          const route: Route = { kind: 'redirect', location: `https://${domain.redirectTo}`, status: 308 };
          this.remember(host, route, domain.projectId);
          return route;
        }
        projectId = domain.projectId;
        deploymentId = domain.current;
      }
    }

    if (!projectId) return this.none(host, 'not_found');
    if (!deploymentId) return this.none(host, 'no_deployment', projectId);

    const [deployment] = await db
      .select({ id: deployments.id, status: deployments.status, config: deployments.config })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!deployment || deployment.status !== 'READY') return this.none(host, 'no_deployment', projectId);

    if ((deployment.config?.type ?? 'static') === 'static') {
      const route: Route = { kind: 'static', projectId, deploymentId };
      this.remember(host, route, projectId);
      return route;
    }

    const running = await db
      .select({ id: instances.id, address: instances.address, port: instances.hostPort })
      .from(instances)
      .where(and(eq(instances.deploymentId, deploymentId), eq(instances.status, 'RUNNING')));
    const endpoints = running.flatMap((i) => (i.address && i.port ? [{ id: i.id, address: i.address, port: i.port }] : []));
    if (endpoints.length === 0) {
      const [row] = await db.select({ sleepingAt: projects.sleepingAt }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (row?.sleepingAt) {
        const sleeping: Route = { kind: 'sleeping', projectId, deploymentId };
        this.cache.set(host, sleeping, { ttl: this.config.negativeTtlMs });
        this.trackHost(projectId, host);
        return sleeping;
      }
      return this.none(host, 'no_instances', projectId);
    }
    const route: Route = { kind: 'service', projectId, deploymentId, endpoints };
    this.remember(host, route, projectId);
    return route;
  }

  private none(host: string, reason: 'not_found' | 'no_deployment' | 'no_instances', projectId?: string): Route {
    const route: Route = { kind: 'none', reason };
    this.remember(host, route, projectId);
    return route;
  }
}
