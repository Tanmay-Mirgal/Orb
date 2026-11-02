"use client";

import { Check, Mail, Sparkles } from "lucide-react";
import { INSTANCE_PLANS, ORG_PLANS, getOrgPlan } from "shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page";

interface Props {
  data: {
    org: { id: string; name: string; plan: string };
    role: string;
    usage: { projects: number; members: number; domains: number; instances: number };
  };
}

function UsageRow({ label, value, max, unit }: { label: string; value: number; max: number; unit?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value} / {max}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <Meter value={value} max={max} />
    </div>
  );
}

export function BillingClient({ data }: Props) {
  const plan = getOrgPlan(data.org.plan);
  const plans = Object.values(ORG_PLANS);
  const isOwner = data.role === "owner";
  return (
    <div className="animate-fade-up max-w-5xl space-y-8">
      <PageHeader title="Usage & billing" description={`Plan and limits for ${data.org.name}.`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardDescription className="uppercase tracking-wider">Current plan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {plan.name} <Badge variant="accent">Active</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-[13px] text-muted-foreground">
            <p className="text-2xl font-semibold text-foreground">
              ${plan.priceUsdMonth}
              <span className="text-sm font-normal text-muted-foreground"> / month</span>
            </p>
            <p>{plan.maxConcurrentBuilds} concurrent build{plan.maxConcurrentBuilds === 1 ? "" : "s"} · {Math.round(plan.buildTimeoutSec / 60)} min build timeout</p>
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

      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Compare plans</h2>
          <p className="text-[13px] text-muted-foreground">Online checkout is not enabled on this installation yet — contact the platform owner to change plans.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const current = p.id === plan.id;
            const largest = p.allowedInstancePlans[p.allowedInstancePlans.length - 1]!;
            const features = [
              `${p.maxProjects} projects`,
              `${p.maxMembers} team member${p.maxMembers === 1 ? "" : "s"}`,
              `${p.maxDomainsPerProject} custom domains / project`,
              `Up to ${p.maxInstancesPerService} instance${p.maxInstancesPerService === 1 ? "" : "s"} per service`,
              `${INSTANCE_PLANS[largest]?.name} instance size and below`,
              `${p.maxConcurrentBuilds} concurrent build${p.maxConcurrentBuilds === 1 ? "" : "s"}`,
              p.previewDeployments ? "Preview deployments" : "No preview deployments",
              `${p.retainedDeployments} deployments kept for rollback`,
            ];
            return (
              <Card key={p.id} className={cn("flex flex-col", current && "border-accent ring-2 ring-accent/20")}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    {p.name}
                    {current && <Badge variant="accent">Current</Badge>}
                  </CardTitle>
                  <p className="pt-1 text-3xl font-semibold tracking-tight">
                    ${p.priceUsdMonth}
                    <span className="text-sm font-normal text-muted-foreground"> / mo</span>
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <ul className="space-y-2 text-[13px]">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-2">
                    {current ? (
                      <Button variant="outline" className="w-full" disabled>
                        Your plan
                      </Button>
                    ) : (
                      <Button variant={p.priceUsdMonth > plan.priceUsdMonth ? "accent" : "outline"} className="w-full" disabled={!isOwner} title={isOwner ? undefined : "Only the team owner can change the plan"}>
                        {p.priceUsdMonth > plan.priceUsdMonth ? <Sparkles /> : <Mail />} {p.priceUsdMonth > plan.priceUsdMonth ? "Request upgrade" : "Request change"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
