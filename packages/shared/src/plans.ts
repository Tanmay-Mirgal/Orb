/**
 * Plan catalogue: per-instance resources (what a running container may use) and
 * per-organisation entitlements (what a tenant may create). Enforced server-side
 * by the API and the build/scheduler workers; the UI only reads this for display.
 */

export interface InstancePlan {
  id: string;
  name: string;
  /** CPU in millicores (1000 = one vCPU). */
  cpuMillis: number;
  memoryMb: number;
  /** Display-only list price, for the UI. Billing integration is out of scope. */
  priceUsdMonth: number;
}

export const INSTANCE_PLANS: Readonly<Record<string, InstancePlan>> = {
  free: { id: 'free', name: 'Free', cpuMillis: 100, memoryMb: 256, priceUsdMonth: 0 },
  starter: { id: 'starter', name: 'Starter', cpuMillis: 500, memoryMb: 512, priceUsdMonth: 7 },
  standard: { id: 'standard', name: 'Standard', cpuMillis: 1000, memoryMb: 2048, priceUsdMonth: 25 },
  pro: { id: 'pro', name: 'Pro', cpuMillis: 2000, memoryMb: 4096, priceUsdMonth: 85 },
};
export const DEFAULT_INSTANCE_PLAN = 'free';

export function getInstancePlan(id: string | null | undefined): InstancePlan {
  return INSTANCE_PLANS[id ?? ''] ?? INSTANCE_PLANS[DEFAULT_INSTANCE_PLAN]!;
}

export interface OrgPlan {
  id: string;
  name: string;
  maxProjects: number;
  maxMembers: number;
  maxDomainsPerProject: number;
  maxInstancesPerService: number;
  /** How many builds of one organisation may run at the same time. */
  maxConcurrentBuilds: number;
  buildTimeoutSec: number;
  allowedInstancePlans: readonly string[];
  previewDeployments: boolean;
  /** Static deployments + images kept per project besides the live one (older ones are garbage-collected). */
  retainedDeployments: number;
  /** API requests / minute per organisation (token or session). */
  apiRatePerMinute: number;
  /** Display-only list price for the pricing page / billing screen. Replace with your real pricing. */
  priceUsdMonth: number;
}

export const ORG_PLANS: Readonly<Record<string, OrgPlan>> = {
  free: {
    id: 'free',
    name: 'Hobby',
    maxProjects: 5,
    maxMembers: 1,
    maxDomainsPerProject: 2,
    maxInstancesPerService: 1,
    maxConcurrentBuilds: 1,
    buildTimeoutSec: 10 * 60,
    allowedInstancePlans: ['free'],
    previewDeployments: false,
    retainedDeployments: 5,
    apiRatePerMinute: 120,
    priceUsdMonth: 0,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    maxProjects: 50,
    maxMembers: 10,
    maxDomainsPerProject: 20,
    maxInstancesPerService: 5,
    maxConcurrentBuilds: 3,
    buildTimeoutSec: 30 * 60,
    allowedInstancePlans: ['free', 'starter', 'standard'],
    previewDeployments: true,
    retainedDeployments: 20,
    apiRatePerMinute: 600,
    priceUsdMonth: 20,
  },
  team: {
    id: 'team',
    name: 'Team',
    maxProjects: 500,
    maxMembers: 100,
    maxDomainsPerProject: 100,
    maxInstancesPerService: 20,
    maxConcurrentBuilds: 10,
    buildTimeoutSec: 45 * 60,
    allowedInstancePlans: ['free', 'starter', 'standard', 'pro'],
    previewDeployments: true,
    retainedDeployments: 50,
    apiRatePerMinute: 3000,
    priceUsdMonth: 99,
  },
};
export const DEFAULT_ORG_PLAN = 'free';

export function getOrgPlan(id: string | null | undefined): OrgPlan {
  return ORG_PLANS[id ?? ''] ?? ORG_PLANS[DEFAULT_ORG_PLAN]!;
}
