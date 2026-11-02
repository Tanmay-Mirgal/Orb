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
  /** Display-only USD list price (kept for API consumers). Razorpay charges the INR price below. */
  priceUsdMonth: number;
  /** What Razorpay charges, in rupees, per month / per year (12 months for the price of 10). 0 = free. */
  priceInrMonth: number;
  priceInrYear: number;
  /**
   * Max container projects (web services, workers, cron). Static sites only cost object storage, so they are
   * limited by `maxProjects` alone. This is the main guard on compute cost for free accounts.
   */
  maxContainerProjects: number;
  /**
   * Web services are stopped after this many idle minutes and woken by the next request (null = always on).
   * Cuts the always-on RAM of free accounts to roughly the services that are really being used.
   */
  idleSleepMinutes: number | null;
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
    priceInrMonth: 0,
    priceInrYear: 0,
    maxContainerProjects: 2,
    idleSleepMinutes: 20,
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
    priceInrMonth: 999,
    priceInrYear: 9990,
    maxContainerProjects: 50,
    idleSleepMinutes: null,
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
    priceInrMonth: 4999,
    priceInrYear: 49990,
    maxContainerProjects: 500,
    idleSleepMinutes: null,
  },
};
export const DEFAULT_ORG_PLAN = 'free';

/** Plans ordered from lowest to highest; used to tell an upgrade from a downgrade. */
export const PLAN_ORDER = ['free', 'pro', 'team'] as const;
export type PaidPlanId = 'pro' | 'team';
export const PAID_PLAN_IDS: readonly PaidPlanId[] = ['pro', 'team'];

export function planRank(id: string | null | undefined): number {
  return PLAN_ORDER.indexOf((id ?? '') as (typeof PLAN_ORDER)[number]);
}

export type BillingInterval = 'monthly' | 'yearly';

/** Price in paise (Razorpay's smallest unit) for one billing period of a paid plan. */
export function planPricePaise(planId: string, interval: BillingInterval): number {
  const plan = getOrgPlan(planId);
  return (interval === 'yearly' ? plan.priceInrYear : plan.priceInrMonth) * 100;
}

/** End of a paid period that starts at `from`: calendar month(s), clamped to the last day of the month. */
export function addBillingPeriod(from: Date, interval: BillingInterval): Date {
  const months = interval === 'yearly' ? 12 : 1;
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function getOrgPlan(id: string | null | undefined): OrgPlan {
  return ORG_PLANS[id ?? ''] ?? ORG_PLANS[DEFAULT_ORG_PLAN]!;
}
