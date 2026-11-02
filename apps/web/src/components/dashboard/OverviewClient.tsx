"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Box, Check, Globe, Plus, Rocket, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { timeAgo, shortSha } from "@/lib/format";
import { ProjectCard, type ProjectCardData } from "./ProjectCard";

interface OverviewData {
  userName: string;
  orgName: string;
  plan: { id: string; name: string; maxProjects: number };
  cards: ProjectCardData[];
  recent: Array<{ id: string; status: string; environment: string; branch: string | null; commitHash: string | null; commitMessage: string | null; createdAt: string; projectName: string; projectSlug: string | null }>;
  live: number;
  failing: number;
  domains: number;
  runningInstances: number;
}

function Onboarding() {
  const steps = [
    { done: true, title: "Sign in with GitHub", text: "Your account is connected, so Orb can list and build your repositories." },
    { done: false, title: "Import a repository", text: "Pick a repo. Orb detects the framework and fills in the build settings.", href: "/dashboard/new", cta: "Import repository" },
    { done: false, title: "Add a custom domain", text: "Point your own domain at the project. HTTPS is issued automatically.", href: "/dashboard/domains", cta: "Open domains" },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-br from-accent-soft to-transparent p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Rocket className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Deploy your first project</h2>
            <p className="text-sm text-muted-foreground">Three quick steps from repository to a live HTTPS URL.</p>
          </div>
        </div>
      </div>
      <ol className="divide-y">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-4 p-5">
            <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${s.done ? "border-success/30 bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
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
  );
}

export function OverviewClient({ data }: { data: OverviewData }) {
  const first = data.userName.split(" ")[0] || "there";
  const empty = data.cards.length === 0;
  return (
    <div className="animate-fade-up space-y-8">
      <PageHeader
        title={`Welcome back, ${first}`}
        description={`Here's what's happening in ${data.orgName}.`}
        actions={
          <Button asChild>
            <Link href="/dashboard/new">
              <Plus /> New project
            </Link>
          </Button>
        }
      />

      {empty ? (
        <Onboarding />
      ) : (
        <>
          {data.failing > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>
                <span className="font-medium">{data.failing} project{data.failing === 1 ? "" : "s"}</span> failed their latest deployment. Open the project to read the build log.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Projects" value={data.cards.length} hint={`of ${data.plan.maxProjects} on the ${data.plan.name} plan`} icon={Box} />
            <StatCard label="Live" value={data.live} hint="serving production traffic" icon={Rocket} />
            <StatCard label="Running instances" value={data.runningInstances} hint="web services & workers" icon={Server} />
            <StatCard label="Custom domains" value={data.domains} hint="with automatic HTTPS" icon={Globe} />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Section title="Recent deployments" className="min-w-0 lg:col-span-3" actions={<Button asChild variant="ghost" size="sm"><Link href="/dashboard/projects">All projects <ArrowRight /></Link></Button>}>
              <Card>
                {data.recent.length === 0 ? (
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">No deployments yet.</CardContent>
                ) : (
                  <ul className="divide-y">
                    {data.recent.map((d) => (
                      <li key={d.id}>
                        <Link href={`/dashboard/projects/${d.projectSlug ?? ""}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-secondary/50">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{d.projectName}</span>
                              {d.environment === "preview" && <span className="rounded border px-1 text-[10px] uppercase text-muted-foreground">preview</span>}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {d.commitMessage ?? "Manual deployment"} · <span className="font-mono">{shortSha(d.commitHash)}</span>
                            </p>
                          </div>
                          <StatusBadge status={d.status} />
                          <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">{timeAgo(d.createdAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Section>

            <Section title="Your projects" className="min-w-0 lg:col-span-2">
              <div className="grid gap-3">
                {data.cards.slice(0, 3).map((c) => (
                  <ProjectCard key={c.project.id} data={c} />
                ))}
                {data.cards.length > 3 && (
                  <Button asChild variant="outline">
                    <Link href="/dashboard/projects">View all {data.cards.length} projects</Link>
                  </Button>
                )}
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

export function NoProjects() {
  return (
    <EmptyState
      icon={Box}
      title="No projects yet"
      description="Import a Git repository to deploy a static site, web service, worker or cron job."
      action={
        <Button asChild>
          <Link href="/dashboard/new">
            <Plus /> New project
          </Link>
        </Button>
      }
    />
  );
}

