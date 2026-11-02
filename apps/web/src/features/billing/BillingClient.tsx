"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, Check, CreditCard, Gift, Moon, ReceiptText, Sparkles } from "lucide-react";
import { INSTANCE_PLANS, ORG_PLANS, getOrgPlan, planRank, type BillingInterval } from "shared";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page";

interface Props {
  data: {
    org: { id: string; name: string; plan: string; planSource: string; planExpiresAt: string | null; isPersonal: boolean };
    role: string;
    billingEnabled: boolean;
    payments: Array<{ id: string; plan: string; interval: string; amount: number; status: string; method: string | null; paidAt: string | null; createdAt: string }>;
    usage: { projects: number; members: number; domains: number; instances: number };
  };
}

interface RazorpayCheckout {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string };
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: any) => void) => void };
  }
}

const inr = (rupees: number) => `₹${rupees.toLocaleString("en-IN")}`;
const date = (d: string | Date) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function loadRazorpay(): Promise<NonNullable<Window["Razorpay"]>> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Payment window did not load")));
    script.onerror = () => reject(new Error("Could not load the payment window. Check your connection or disable the ad blocker for this page."));
    document.head.appendChild(script);
  });
}

function UsageRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value} / {max}</span>
      </div>
      <Meter value={value} max={max} />
    </div>
  );
}

function planFeatures(p: (typeof ORG_PLANS)[string]) {
  const largest = p.allowedInstancePlans[p.allowedInstancePlans.length - 1]!;
  return [
    `${p.maxProjects} projects`,
    p.maxMembers === 1 ? "1 person (no team invites)" : `${p.maxMembers} team members with roles`,
    `${p.maxContainerProjects} web service / worker / cron projects`,
    p.idleSleepMinutes ? `Services sleep after ${p.idleSleepMinutes} min idle` : "Services stay always on",
    `${p.maxDomainsPerProject} custom domains / project`,
    `Up to ${p.maxInstancesPerService} instance${p.maxInstancesPerService === 1 ? "" : "s"} · ${INSTANCE_PLANS[largest]?.name} size`,
    `${p.maxConcurrentBuilds} concurrent build${p.maxConcurrentBuilds === 1 ? "" : "s"}`,
    p.previewDeployments ? "Preview deployments" : "No preview deployments",
  ];
}

export function BillingClient({ data }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [interval, setIntervalKind] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  const plan = getOrgPlan(data.org.plan);
  const plans = Object.values(ORG_PLANS);
  const isOwner = data.role === "owner";
  const canSeeBilling = isOwner || data.role === "admin";
  const expires = data.org.planExpiresAt ? new Date(data.org.planExpiresAt) : null;
  const daysLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000)) : null;
  const paid = plan.id !== "free";

  const checkout = async (planId: string) => {
    setBusy(planId);
    try {
      const order = await api<RazorpayCheckout>("/api/v1/billing/checkout", { method: "POST", body: JSON.stringify({ plan: planId, interval }) });
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        prefill: order.prefill,
        theme: { color: "#4a63ff" },
        modal: { ondismiss: () => setBusy(null) },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api("/api/v1/billing/verify", { method: "POST", body: JSON.stringify(response) });
            toast.success("Payment received", `${getOrgPlan(planId).name} plan is now active.`);
            router.refresh();
          } catch (e) {
            toast.error("We got your payment but could not confirm it yet", `${errorMessage(e)} Your plan will update automatically in a few minutes.`);
          } finally {
            setBusy(null);
          }
        },
      });
      rzp.on("payment.failed", (r: { error?: { description?: string } }) => {
        toast.error("Payment failed", r.error?.description ?? "The payment did not go through.");
        setBusy(null);
      });
      rzp.open();
    } catch (e) {
      toast.error("Could not start checkout", errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="animate-fade-up max-w-5xl space-y-8">
      <PageHeader title="Usage & billing" description={`Plan, limits and payments for ${data.org.name}.`} />

      {paid && daysLeft !== null && daysLeft <= 7 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            Your <b className="font-medium">{plan.name}</b> plan ends in <b className="font-medium">{daysLeft} day{daysLeft === 1 ? "" : "s"}</b>, then this team returns to Hobby.
            {isOwner ? " Renew below — the new period starts after the current one, nothing is lost." : " Ask the team owner to renew it."}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardDescription className="uppercase tracking-wider">Current plan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {plan.name}
              {data.org.planSource === "grant" ? <Badge variant="accent"><Gift className="size-3" /> Complimentary</Badge> : <Badge variant="success" dot>Active</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px] text-muted-foreground">
            {paid && expires ? (
              <p className="text-foreground">
                {data.org.planSource === "grant" ? "Free until " : "Paid until "}
                <b className="font-semibold">{date(expires)}</b>
                {daysLeft !== null && daysLeft > 30 ? <span className="text-muted-foreground"> · {Math.round(daysLeft / 30)} months left</span> : daysLeft !== null ? <span className="text-muted-foreground"> · {daysLeft} days left</span> : null}
              </p>
            ) : (
              <p className="text-foreground"><b className="text-2xl font-semibold">{inr(0)}</b> <span className="text-muted-foreground">forever</span></p>
            )}
            <p>{plan.maxConcurrentBuilds} concurrent build{plan.maxConcurrentBuilds === 1 ? "" : "s"} · {Math.round(plan.buildTimeoutSec / 60)} min build timeout</p>
            {plan.idleSleepMinutes && (
              <p className="flex items-start gap-1.5"><Moon className="mt-0.5 size-3.5 shrink-0" /> Web services sleep after {plan.idleSleepMinutes} minutes without traffic and wake on the next request.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Limits are enforced per team.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <UsageRow label="Projects" value={data.usage.projects} max={plan.maxProjects} />
            <UsageRow label="Team members" value={data.usage.members} max={plan.maxMembers} />
            <UsageRow label="Custom domains" value={data.usage.domains} max={plan.maxDomainsPerProject * Math.max(1, data.usage.projects)} />
            <UsageRow label="Running instances" value={data.usage.instances} max={plan.maxInstancesPerService * Math.max(1, data.usage.projects)} />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Plans</h2>
            <p className="text-[13px] text-muted-foreground">
              {isOwner ? "Pay once per period with UPI, card or netbanking. Nothing renews automatically — we remind you before it ends." : "Only the team owner can change the plan."}
            </p>
          </div>
          <div role="group" aria-label="Billing period" className="inline-flex rounded-lg border bg-card p-0.5 text-[13px] shadow-sm">
            {(["monthly", "yearly"] as const).map((k) => (
              <button key={k} onClick={() => setIntervalKind(k)} aria-pressed={interval === k} className={cn("rounded-md px-3 py-1.5 font-medium transition-colors", interval === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {k === "monthly" ? "Monthly" : "Yearly"} {k === "yearly" && <span className={cn("ml-1 text-[11px]", interval === k ? "opacity-80" : "text-success")}>2 months free</span>}
              </button>
            ))}
          </div>
        </div>

        {!data.billingEnabled && isOwner && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px]">Online payments are not configured yet. Add the Razorpay keys to the server environment to enable checkout.</p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const current = p.id === plan.id;
            const higher = planRank(p.id) > planRank(plan.id);
            const price = interval === "yearly" ? p.priceInrYear : p.priceInrMonth;
            const label = current && paid ? "Renew" : higher ? `Upgrade to ${p.name}` : "";
            return (
              <Card key={p.id} className={cn("flex flex-col", current && "border-accent ring-2 ring-accent/20")}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    {p.name}
                    {current && <Badge variant="accent">Current</Badge>}
                  </CardTitle>
                  <p className="pt-1 text-3xl font-semibold tracking-tight tabular-nums">
                    {price === 0 ? "Free" : inr(price)}
                    {price > 0 && <span className="text-sm font-normal text-muted-foreground"> / {interval === "yearly" ? "year" : "month"}</span>}
                  </p>
                  {price > 0 && interval === "yearly" && <p className="text-xs text-muted-foreground">{inr(Math.round(price / 12))} / month, billed yearly</p>}
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <ul className="space-y-2 text-[13px]">
                    {planFeatures(p).map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-2">
                    {p.id === "free" ? (
                      <Button variant="outline" className="w-full" disabled>{current ? "Your plan" : "Included with every team"}</Button>
                    ) : label ? (
                      <Button
                        variant={higher ? "accent" : "outline"}
                        className="w-full"
                        disabled={!isOwner || !data.billingEnabled}
                        loading={busy === p.id}
                        title={isOwner ? undefined : "Only the team owner can change the plan"}
                        onClick={() => void checkout(p.id)}
                      >
                        {busy !== p.id && (higher ? <Sparkles /> : <CreditCard />)} {label} · {inr(price)}
                      </Button>
                    ) : (
                      <Button variant="outline" className="w-full" disabled>Lower than your plan</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {canSeeBilling && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><ReceiptText className="size-4 text-muted-foreground" /> Payment history</h2>
          <Card className="overflow-hidden">
            {data.payments.length === 0 ? (
              <CardContent className="py-10 text-center text-sm text-muted-foreground">No payments yet.</CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="border-b bg-secondary/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Date</th>
                      <th className="px-4 py-2.5 font-medium">Plan</th>
                      <th className="px-4 py-2.5 font-medium">Method</th>
                      <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                      <th className="px-4 py-2.5 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap px-4 py-3">{date(p.paidAt ?? p.createdAt)}</td>
                        <td className="px-4 py-3 capitalize">{getOrgPlan(p.plan).name} · {p.interval}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{p.method ?? "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{inr(p.amount / 100)}</td>
                        <td className="px-4 py-3 text-right">
                          {p.status === "paid" ? <Badge variant="success"><BadgeCheck className="size-3" /> Paid</Badge> : p.status === "failed" ? <Badge variant="danger">Failed</Badge> : <Badge variant="neutral">Not completed</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
