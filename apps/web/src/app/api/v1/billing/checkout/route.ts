import { checkoutSchema, type BillingInterval } from 'shared';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';
import { createCheckout } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

/** Creates a Razorpay order for a plan. Only the team owner can start a purchase. */
export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req);
  requirePermission(role, 'billing:manage');
  const input = await parseBody(req, checkoutSchema);
  const checkout = await createCheckout({
    org,
    user: { id: auth.userId, name: auth.userName, email: auth.email },
    plan: input.plan,
    interval: input.interval as BillingInterval,
  });
  await audit(auth, { orgId: org.id, action: 'billing.checkout', targetType: 'plan', targetId: input.plan, metadata: { interval: input.interval, orderId: checkout.orderId } });
  return checkout;
});
