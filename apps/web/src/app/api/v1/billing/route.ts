import { getOrgPlan } from 'shared';
import { route } from '@/server/api';
import { authenticate, orgContext, requirePermission } from '@/server/context';
import { activePlanId, listPayments, razorpayConfig } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

/** Plan, expiry and payment history of the active team. Visible to admins and owners. */
export const GET = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req);
  requirePermission(role, 'billing:read');
  const payments = await listPayments(org.id);
  return {
    enabled: razorpayConfig().enabled,
    plan: getOrgPlan(activePlanId(org)),
    planSource: org.planSource,
    planExpiresAt: org.planExpiresAt,
    canManage: role === 'owner',
    payments: payments.map((p) => ({
      id: p.id,
      plan: p.plan,
      interval: p.billingInterval,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      periodEnd: p.periodEnd,
    })),
  };
});
