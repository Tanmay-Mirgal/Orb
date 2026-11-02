import { platformConfig } from 'core';
import { INSTANCE_PLANS, ORG_PLANS } from 'shared';
import { route } from '@/server/api';
import { authenticate } from '@/server/context';

export const dynamic = 'force-dynamic';

/** Static platform facts the dashboard needs (plans, DNS targets, base domain). */
export const GET = route(async ({ req }) => {
  await authenticate(req);
  const { baseDomain, cnameTarget, platformIps, scheme } = platformConfig();
  return {
    baseDomain,
    cnameTarget,
    platformIps,
    scheme,
    instancePlans: Object.values(INSTANCE_PLANS),
    orgPlans: Object.values(ORG_PLANS),
  };
});
