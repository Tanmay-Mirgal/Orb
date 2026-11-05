import { getOrgPlan } from 'shared';
import { connectAuthed } from './auth';
import { loadCapabilities, loadOrgUsage, planLimits } from './usage';

/** `GET /api/connect/v1/me`: any valid token. */
export const meRoute = connectAuthed({}, async ({ auth }) => {
  const [usage, capabilities] = await Promise.all([loadOrgUsage(auth.org.id), loadCapabilities(auth.userId, auth.org, auth.role)]);
  const plan = getOrgPlan(auth.org.plan);
  return {
    user: { id: auth.userId, email: auth.email, name: auth.userName },
    tenant: { id: auth.org.id, name: auth.org.name, slug: auth.org.slug, kind: 'organization' as const },
    scopes: auth.scopes,
    grantId: auth.connector.grantId,
    plan: {
      id: plan.id,
      name: plan.name,
      expiresAt: auth.org.planExpiresAt ? auth.org.planExpiresAt.toISOString() : null,
      limits: planLimits(auth.org),
      usage,
    },
    capabilities,
  };
});
