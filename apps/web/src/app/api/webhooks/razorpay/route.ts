import { failPayment, settlePayment, verifyWebhookSignature, type RzpPayment } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

interface WebhookEvent {
  event: string;
  payload?: { payment?: { entity?: RzpPayment } };
}

/**
 * Razorpay -> Orb. Settles a payment even when the buyer closed the tab before the browser callback ran.
 * Configure in Razorpay Dashboard → Webhooks: URL `<app>/api/webhooks/razorpay`, events `payment.captured`,
 * `order.paid` and `payment.failed`, with the same secret as RAZORPAY_WEBHOOK_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature'))) {
    return new Response('invalid signature', { status: 401 });
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const payment = event.payload?.payment?.entity;
  try {
    if (payment?.order_id) {
      if (event.event === 'payment.captured' || event.event === 'order.paid') await settlePayment(payment.order_id, payment);
      else if (event.event === 'payment.failed') await failPayment(payment.order_id, payment.error_description ?? null);
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'razorpay webhook failed', event: event.event, err: String(err) }));
    return new Response('error', { status: 500 }); // Razorpay retries with backoff
  }
  return new Response('ok');
}
