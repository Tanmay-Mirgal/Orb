"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, Box, Check, CreditCard, Globe, Moon, Plus, Rocket, Server, Sparkles, UserPlus, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/feedback";
import { Section } from "@/components/app/page";
import { formatBytes, formatNumber, shortSha, timeAgo } from "@/lib/format";
import { ProjectCard, type ProjectCardData } from "./ProjectCard";

interface OverviewData {
  userName: string;
  orgName: string;
  isPersonal: boolean;
  role: string;
  plan: { id: string; name: string; maxProjects: number; maxMembers: number; expiresAt: string | null; source: string };
  cards: ProjectCardData[];
  recent: Array<{ id: string; status: string; environment: string; branch: string | null; commitHash: string | null; commitMessage: string | null; createdAt: string; projectName: string; projectSlug: string | null }>;
  live: number;
  failing: number;
  sleeping: number;
  domains: number;
  runningInstances: number;
  traffic: { series: number[]; requests: number; bytes: number };
  members: { count: number; preview: Array<{ name: string; image: string | null }> };
}

/** Tiny dependency-free area chart. `values` are already bucketed, so this only scales and draws. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const id = useId();
  const w = 120;
  const h = 36;
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const flat = values.every((v) => v === 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-9 w-full", className)} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={flat ? 0 : 0.28} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity={flat ? 0.35 : 1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Avatar({ name, image, className }: { name: string; image?: string | null; className?: string }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className={cn("size-7 rounded-full border-2 border-card object-cover", className)} />;
  }
  return (
    <span className={cn("flex size-7 items-center justify-center rounded-full border-2 border-card bg-accent-soft text-[11px] font-semibold text-accent", className)}>
      {name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Kpi({ label, value, hint, icon: Icon, children, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ComponentType<{ className?: string }>; children?: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-foreground/15">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className={cn("flex size-7 items-center justify-center rounded-lg bg-secondary text-muted-foreground", tone === "good" && "bg-success/12 text-success", tone === "warn" && "bg-warning/12 text-warning")}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
      {children}
    </div>
  );
}

function Onboarding({ first }: { first: string }) {
  const steps = [
    { done: true, title: "Sign in with GitHub", text: "Connected, so Orb can list and build your repositories." },
    { done: false, title: "Import a repository", text: "Pick a repo. Orb detects the framework and fills in the build settings.", href: "/dashboard/new", cta: "Import repository" },
    { done: false, title: "Go live on your own domain", text: "Point a domain at the project. HTTPS is issued automatically.", href: "/dashboard/domains", cta: "Open domains" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="overflow-hidden lg:col-span-3">
        <div className="relative border-b p-6">
          <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-accent/20 blur-3xl" aria-hidden />
          <div className="relative flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-md">
              <Rocket className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Deploy your first project, {first}</h2>
              <p className="text-sm text-muted-foreground">Three quick steps from repository to a live HTTPS URL.</p>
            </div>
          </div>
        </div>
        <ol className="divide-y">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-4 p-5">
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", s.done ? "border-success/30 bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                {s.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">{s.title}</h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{s.text}</p>
              </div>
              {s.href && (
                <Button asChild size="sm" variant={i === 1 ? "default" : "outline"}>
                  <Link href={s.href}>{s.cta}</Link>
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Card>
      <Card className="flex flex-col justify-between p-6 lg:col-span-2">
        <div>
          <Badge variant="accent"><Sparkles className="size-3" /> Hobby plan · free</Badge>
          <h3 className="mt-4 text-base font-semibold tracking-tight">What you get</h3>
          <ul className="mt-3 space-y-2.5 text-[13px] text-muted-foreground">
            {["5 projects, unlimited static traffic", "2 web services / workers that sleep when idle", "Automatic HTTPS and custom domains", "E-mail alerts when a deploy fails"].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" /> {t}</li>
            ))}
          </ul>
        </div>
        <Button asChild variant="outline" className="mt-6"><Link href="/dashboard/billing">Compare plans <ArrowRight /></Link></Button>
      </Card>
    </div>
  );
}

export function OverviewClient({ data }: { data: OverviewData }) {
  const first = data.userName.split(" ")[0] || "there";
  const empty = data.cards.length === 0;
  const [greeting, setGreeting] = useState("Welcome back");
  const [today, setToday] = useState("");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    setToday(new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }));
  }, []);

  const { plan } = data;
  const isOwner = data.role === "owner";
  const planDays = plan.expiresAt ? Math.ceil((new Date(plan.expiresAt).getTime() - Date.now()) / 86_400_000) : null;
  const planEnding = plan.id !== "free" && planDays !== null && planDays <= 7;
  const healthy = data.failing === 0;

  return (
    <div className="animate-fade-up space-y-6">
      <section className="relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-accent/15 blur-3xl" aria-hidden />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{today || "Overview"}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {greeting}, <span className="text-accent">{first}</span>
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">{data.orgName}</span>
              <Badge variant={plan.id === "free" ? "neutral" : "accent"}>{plan.name}</Badge>
              <Badge variant={healthy ? "success" : "danger"} dot pulse={!healthy}>{healthy ? "All systems normal" : `${data.failing} failing`}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/dashboard/new"><Plus /> New project</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/dashboard/domains"><Globe /> Add domain</Link>
            </Button>
            {!data.isPersonal && (
              <Button asChild size="lg" variant="outline">
                <Link href="/dashboard/team"><UserPlus /> Invite</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {planEnding && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1">
            Your <b className="font-medium">{plan.name}</b> plan ends in <b className="font-medium">{planDays} day{planDays === 1 ? "" : "s"}</b>, then {data.orgName} returns to Hobby.
          </p>
          {isOwner && <Button asChild size="sm"><Link href="/dashboard/billing">Renew plan</Link></Button>}
        </div>
      )}

      {empty ? (
        <Onboarding first={first} />
      ) : (
        <>
          {data.failing > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>
                <span className="font-medium">{data.failing} project{data.failing === 1 ? "" : "s"}</span> failed their latest deployment. Open the project to read the build log — the previous version keeps serving.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Projects" value={<>{data.cards.length}<span className="text-base font-normal text-muted-foreground"> / {plan.maxProjects}</span></>} icon={Box}>
              <Meter value={data.cards.length} max={plan.maxProjects} className="mt-3" />
            </Kpi>
            <Kpi label="Live" value={data.live} hint={data.failing > 0 ? `${data.failing} need attention` : "serving production traffic"} icon={Rocket} tone={data.failing > 0 ? "warn" : "good"} />
            <Kpi label="Requests · 24h" value={formatNumber(data.traffic.requests)} hint={data.traffic.bytes ? `${formatBytes(data.traffic.bytes)} served` : "no traffic yet"} icon={Activity}>
              <Sparkline values={data.traffic.series} className="mt-2.5" />
            </Kpi>
            <Kpi
              label="Running instances"
              value={data.runningInstances}
              hint={data.sleeping > 0 ? <span className="inline-flex items-center gap-1"><Moon className="size-3" /> {data.sleeping} asleep, wakes on request</span> : "web services & workers"}
              icon={Server}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Section title="Recent deployments" className="min-w-0 lg:col-span-2" actions={<Button asChild variant="ghost" size="sm"><Link href="/dashboard/projects">All projects <ArrowRight /></Link></Button>}>
              <Card className="overflow-hidden">
                {data.recent.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">No deployments yet.</div>
                ) : (
                  <ul className="relative">
                    <span className="absolute bottom-6 left-[1.65rem] top-6 w-px bg-border" aria-hidden />
                    {data.recent.map((d) => (
                      <li key={d.id}>
                        <Link href={`/dashboard/projects/${d.projectSlug ?? ""}`} className="group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-secondary/50 sm:px-5">
                          <span className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border bg-card">
                            <span className={cn("size-2 rounded-full", d.status === "READY" ? "bg-success" : d.status === "FAILED" ? "bg-destructive" : d.status === "CANCELED" || d.status === "ARCHIVED" ? "bg-muted-foreground/50" : "animate-pulse bg-warning")} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium group-hover:text-accent">{d.projectName}</span>
                              {d.environment === "preview" && <span className="rounded border px-1 text-[10px] uppercase text-muted-foreground">preview</span>}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {d.commitMessage ?? "Manual deployment"} · <span className="font-mono">{shortSha(d.commitHash)}</span>
                            </p>
                          </div>
                          <StatusBadge status={d.status} className="hidden sm:inline-flex" />
                          <span className="w-28 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Section>

            <div className="min-w-0 space-y-6">
              <Section title="Plan & usage">
                <Card className="space-y-4 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{plan.name} plan</p>
                      <p className="text-xs text-muted-foreground">
                        {plan.id === "free" ? "Free forever" : plan.source === "grant" ? `Complimentary until ${plan.expiresAt ? new Date(plan.expiresAt).getFullYear() : "—"}` : plan.expiresAt ? `Active until ${new Date(plan.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Active"}
                      </p>
                    </div>
                    <Button asChild size="sm" variant={plan.id === "free" ? "accent" : "outline"}>
                      <Link href="/dashboard/billing">{plan.id === "free" ? <><Sparkles /> Upgrade</> : <><CreditCard /> Manage</>}</Link>
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">Projects</span><span className="tabular-nums">{data.cards.length} / {plan.maxProjects}</span></div>
                      <Meter value={data.cards.length} max={plan.maxProjects} />
                    </div>
                    <div>
                      <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">Members</span><span className="tabular-nums">{data.members.count} / {plan.maxMembers}</span></div>
                      <Meter value={data.members.count} max={plan.maxMembers} />
                    </div>
                  </div>
                </Card>
              </Section>

              <Section title="Team">
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex -space-x-2">
                      {data.members.preview.map((m, i) => <Avatar key={i} name={m.name} image={m.image} />)}
                      {data.members.count > data.members.preview.length && (
                        <span className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-secondary text-[10px] font-medium text-muted-foreground">+{data.members.count - data.members.preview.length}</span>
                      )}
                    </div>
                    <Button asChild size="sm" variant="outline"><Link href="/dashboard/team"><Users /> {data.isPersonal ? "Create a team" : "Manage"}</Link></Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {data.isPersonal ? "This is your personal space. Create a team to share projects, domains and billing." : `${data.members.count} member${data.members.count === 1 ? "" : "s"} can access ${data.orgName}. Invite teammates by e-mail with roles.`}
                  </p>
                </Card>
              </Section>
            </div>
          </div>

          <Section
            title="Your projects"
            actions={<Button asChild variant="ghost" size="sm"><Link href="/dashboard/projects">View all <ArrowUpRight /></Link></Button>}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.cards.slice(0, 6).map((c) => (
                <ProjectCard key={c.project.id} data={c} />
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

export function NoProjects() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border bg-card shadow-sm">
        <Box className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">No projects yet</h3>
        <p className="mx-auto max-w-sm text-[13px] text-muted-foreground">Import a Git repository to deploy a static site, web service, worker or cron job.</p>
      </div>
      <Button asChild>
        <Link href="/dashboard/new">
          <Plus /> New project
        </Link>
      </Button>
    </div>
  );
}
