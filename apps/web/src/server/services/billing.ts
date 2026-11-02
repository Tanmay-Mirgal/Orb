import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { emailTemplates, env, platformConfig } from 'core';
import { and, desc, eq, notify, orgMemberIds, organizations, payments, type Organization, type Payment } from 'database';
import { addBillingPeriod, getOrgPlan, NotificationType, planPricePaise, planRank, type BillingInterval } from 'shared';
import { db } from '@/lib/db';
import { ApiError, conflict, enforceRateLimit, notFound } from '../api';

const API = 'https://api.razorpay.com/v1';

export function razorpayConfig() {
  const keyId = env('RAZORPAY_KEY_ID') ?? env('NEXT_PUBLIC_RAZORPAY_KEY_ID');
  const keySecret = env('RAZORPAY_KEY_SECRET');
  return { keyId, keySecret, webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'), enabled: Boolean(keyId && keySecret) };
}

interface RzpOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RzpPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  error_description?: string | null;
}

async function rzp<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const { keyId, keySecret } = razorpayConfig();
  if (!keyId || !keySecret) throw new ApiError(503, 'Online payments are not configured on this installation', 'billing_disabled');
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & Record<string, unknown>;
  if (!res.ok) {
    console.error(JSON.stringify({ level: 'error', msg: 'razorpay request failed', path, status: res.status, description: json.error?.description }));
    throw new ApiError(502, 'The payment provider rejected the request. Please try again.', 'payment_provider');
  }
  return json as T;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Razorpay Checkout signs `order_id|payment_id` with the key secret; anything else is a forged confirmation. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const { keySecret } = razorpayConfig();
  if (!keySecret) return false;
  return safeEqual(createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex'), signature);
}

/** Webhooks are signed over the raw body with the webhook secret configured in the Razorpay dashboard. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const { webhookSecret } = razorpayConfig();
  if (!webhookSecret || !signature) return false;
  return safeEqual(createHmac('sha256', webhookSecret).update(rawBody).digest('hex'), signature);
}

/** The plan an organisation effectively has right now (an expired paid plan counts as Hobby). */
export function activePlanId(org: Pick<Organization, 'plan' | 'planExpiresAt'>): string {
  if (org.plan !== 'free' && org.planExpiresAt && org.planExpiresAt.getTime() <= Date.now()) return 'free';
  return org.plan;
}

export async function createCheckout(options: {
  org: Organization;
  user: { id: string; name: string; email: string };
  plan: string;
  interval: BillingInterval;
}) {
  const { org, user, plan, interval } = options;
  const cfg = razorpayConfig();
  if (!cfg.enabled || !cfg.keyId) throw new ApiError(503, 'Online payments are not configured on this installation', 'billing_disabled');
  const target = getOrgPlan(plan);
  if (target.id !== plan || target.priceInrMonth <= 0) throw conflict('That plan cannot be purchased');
  if (planRank(plan) < planRank(activePlanId(org))) throw conflict(`This team is already on a higher plan than ${target.name}`);
  await enforceRateLimit(`checkout:${org.id}`, 10, 3600);

  // The price always comes from the server-side catalogue, never from the browser.
  const amount = planPricePaise(plan, interval);
  const order = await rzp<RzpOrder>('/orders', {
    method: 'POST',
    body: {
      amount,
      currency: 'INR',
      receipt: `orb_${randomBytes(8).toString('hex')}`,
      notes: { orgId: org.id, plan, interval },
    },
  });
  await db.insert(payments).values({
    orgId: org.id,
    userId: user.id,
    plan,
    billingInterval: interval,
    amount,
    currency: 'INR',
    razorpayOrderId: order.id,
  });
  return {
    keyId: cfg.keyId,
    orderId: order.id,
    amount,
    currency: 'INR',
    name: 'Orb',
    description: `${target.name} plan · ${interval === 'yearly' ? '12 months' : '1 month'} · ${org.name}`,
    prefill: { name: user.name, email: user.email },
  };
}

async function loadOrg(orgId: string): Promise<Organization> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw notFound('Team');
  return org;
}

/** Called by the browser after Checkout succeeded. Trusts nothing the browser says: signature + provider lookup. */
export async function confirmPayment(options: { orgId: string; orderId: string; paymentId: string; signature: string }) {
  const { orgId, orderId, paymentId, signature } = options;
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) throw new ApiError(400, 'Payment signature mismatch', 'bad_signature');
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.razorpayOrderId, orderId), eq(payments.orgId, orgId)))
    .limit(1);
  if (!row) throw notFound('Payment');
  if (row.status === 'paid') return { payment: row, org: await loadOrg(orgId) };

  let remote = await rzp<RzpPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  if (remote.order_id !== orderId || remote.amount !== row.amount || remote.currency !== row.currency) {
    throw new ApiError(400, 'Payment does not match the order', 'payment_mismatch');
  }
  // Accounts with manual capture leave the payment "authorized"; an uncaptured payment is auto-refunded later.
  if (remote.status === 'authorized') {
    remote = await rzp<RzpPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: 'POST',
      body: { amount: row.amount, currency: row.currency },
    });
  }
  if (remote.status !== 'captured') {
    throw conflict('The payment has not been completed yet. If you were charged, your plan updates automatically within a few minutes.');
  }
  const settled = await settlePayment(orderId, remote);
  if (!settled) throw notFound('Payment');
  return settled;
}

/**
 * Marks a captured payment as paid and extends the team's plan. Idempotent and race-safe (row locks), because the
 * browser callback and the webhook usually arrive within milliseconds of each other.
 */
export async function settlePayment(orderId: string, remote: Pick<RzpPayment, 'id' | 'method'>): Promise<{ payment: Payment; org: Organization } | null> {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.razorpayOrderId, orderId)).for('update');
    if (!row) return null;
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, row.orgId)).for('update');
    if (!org) return null;
    if (row.status === 'paid') return { payment: row, org, fresh: false };

    const now = new Date();
    const interval = row.billingInterval as BillingInterval;
    // Renewing the plan the team is on stacks the new period after the current one: paying early loses nothing.
    const sameActive = org.plan === row.plan && org.planExpiresAt !== null && org.planExpiresAt > now;
    const periodStart = sameActive ? org.planExpiresAt! : now;
    const periodEnd = addBillingPeriod(periodStart, interval);
    const higherActive = org.plan !== 'free' && planRank(org.plan) > planRank(row.plan) && (org.planExpiresAt === null || org.planExpiresAt > now);

    const [payment] = await tx
      .update(payments)
      .set({ status: 'paid', razorpayPaymentId: remote.id, method: remote.method ?? null, periodStart, periodEnd, paidAt: now, failureReason: null })
      .where(eq(payments.id, row.id))
      .returning();
    let updatedOrg = org;
    if (!higherActive) {
      [updatedOrg] = await tx
        .update(organizations)
        .set({ plan: row.plan, planSource: 'paid', planExpiresAt: periodEnd, updatedAt: now })
        .where(eq(organizations.id, org.id))
        .returning();
    }
    return { payment: payment!, org: updatedOrg!, fresh: true };
  });
  if (!outcome) return null;

  if (outcome.fresh) {
    const { payment, org } = outcome;
    const plan = getOrgPlan(payment.plan);
    const billingUrl = `${platformConfig().dashboardUrl}/dashboard/billing`;
    const owners = await orgMemberIds(db, org.id, ['owner']);
    await notify(db, {
      userIds: [payment.userId, ...owners],
      orgId: org.id,
      category: 'billing',
      type: NotificationType.BILLING_PAID,
      title: `${plan.name} plan active for ${org.name}`,
      body: `Payment received. Active until ${payment.periodEnd?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
      href: '/dashboard/billing',
      email: () =>
        emailTemplates.paymentReceipt({
          orgName: org.name,
          planName: plan.name,
          interval: payment.billingInterval,
          amountPaise: payment.amount,
          paymentId: payment.razorpayPaymentId ?? payment.razorpayOrderId,
          periodStart: payment.periodStart!,
          periodEnd: payment.periodEnd!,
          billingUrl,
        }),
    });
  }
  return { payment: outcome.payment, org: outcome.org };
}

export async function failPayment(orderId: string, reason: string | null): Promise<void> {
  const [row] = await db
    .update(payments)
    .set({ status: 'failed', failureReason: reason?.slice(0, 500) ?? null })
    .where(and(eq(payments.razorpayOrderId, orderId), eq(payments.status, 'created')))
    .returning();
  if (!row) return;
  const org = await loadOrg(row.orgId).catch(() => null);
  if (!org) return;
  const plan = getOrgPlan(row.plan);
  await notify(db, {
    userIds: [row.userId],
    orgId: org.id,
    category: 'billing',
    type: NotificationType.BILLING_FAILED,
    title: `Payment for ${plan.name} failed`,
    body: reason ?? 'The payment did not go through. Your plan is unchanged.',
    href: '/dashboard/billing',
    email: () => emailTemplates.paymentFailed({ orgName: org.name, planName: plan.name, reason, billingUrl: `${platformConfig().dashboardUrl}/dashboard/billing` }),
  });
}

export async function listPayments(orgId: string, limit = 20): Promise<Payment[]> {
  return db.select().from(payments).where(eq(payments.orgId, orgId)).orderBy(desc(payments.createdAt)).limit(limit);
}
