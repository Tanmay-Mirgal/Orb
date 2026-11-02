import { getOrgPlan, verifyPaymentSchema } from 'shared';
import { parseBody, route } from '@/server/api';
import { audit } from '@/server/audit';
import { authenticate, orgContext, requirePermission } from '@/server/context';
import { confirmPayment } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

/** Browser callback after Razorpay Checkout succeeded: verifies the signature and activates the plan. */
export const POST = route(async ({ req }) => {
  const auth = await authenticate(req);
  const { org, role } = await orgContext(auth, req);
  requirePermission(role, 'billing:manage');
  const input = await parseBody(req, verifyPaymentSchema);
  const { payment, org: updated } = await confirmPayment({
    orgId: org.id,
    orderId: input.razorpay_order_id,
    paymentId: input.razorpay_payment_id,
    signature: input.razorpay_signature,
  });
  await audit(auth, { orgId: org.id, action: 'billing.paid', targetType: 'payment', targetId: payment.id, metadata: { plan: payment.plan, amount: payment.amount } });
  return { ok: true, plan: getOrgPlan(updated.plan).name, planExpiresAt: updated.planExpiresAt };
});
