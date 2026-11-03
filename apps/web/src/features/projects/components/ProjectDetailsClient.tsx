"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, Box, CheckCircle2, Container, ExternalLink, Eye, EyeOff, GitBranch, Globe, Lock, Play, RefreshCcw, RotateCcw, Settings as SettingsIcon, Terminal, Trash2, XCircle,
} from "lucide-react";
import { imageReferenceError, normalizeRegistryHost, parseImageReference } from "shared";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatNumber, hostOf, projectUrl, shortSha, timeAgo, TYPE_LABEL } from "@/lib/format";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { CopyButton, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented, Tabs, type TabItem } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { GithubIcon, StatCard } from "@/components/app/page";

type Tab = "overview" | "deployments" | "logs" | "domains" | "env" | "analytics" | "settings";
const IN_FLIGHT = ["QUEUED", "BUILDING", "DEPLOYING"];

function useDeployments(projectId: string) {
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setDeployments((await api(`/api/v1/projects/${projectId}/deployments`)).deployments);
    } catch {
      /* keep stale data */
    } finally {
      setLoaded(true);
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const busy = deployments.some((d) => IN_FLIGHT.includes(d.status));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, refresh]);
  return { deployments, refresh, loaded, busy };
}

export type RegistryLogin = { username: string; host: string };

export function ProjectDetailsClient({ project, repository, role, registryLogin }: { project: any; repository: any; role: string; registryLogin?: RegistryLogin | null }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const { deployments, refresh, loaded } = useDeployments(project.id);
  const canDeploy = role !== "viewer";
  const isStatic = project.type === "static";
  const isImage = project.sourceType === "image";
  const url = projectUrl(project.slug);

  const live = deployments.find((d) => d.id === project.currentDeploymentId) ?? deployments.find((d) => d.status === "READY" && d.environment === "production");
  const active = deployments.find((d) => d.id === selected) ?? deployments[0];

  const deploy = async () => {
    setDeploying(true);
    try {
      const data = await api(`/api/v1/projects/${project.id}/deployments`, { method: "POST", body: "{}" });
      setSelected(data.deployment.id);
      setTab("overview");
      toast.success("Deployment queued");
      await refresh();
    } catch (e) {
      toast.error("Couldn't start deployment", errorMessage(e));
    } finally {
      setDeploying(false);
    }
  };

  const act = async (id: string, action: "cancel" | "promote" | "redeploy") => {
    try {
      const data = await api(`/api/v1/deployments/${id}/${action}`, { method: "POST", body: "{}" });
      if (action === "redeploy") setSelected(data.deployment.id);
      toast.success(action === "cancel" ? "Deployment canceled" : action === "promote" ? "Promoting deployment…" : "Redeploy queued");
      await refresh();
    } catch (e) {
      toast.error("Action failed", errorMessage(e));
    }
  };

  const tabs: TabItem<Tab>[] = [
    { id: "overview", label: "Overview", icon: Box },
    { id: "deployments", label: "Deployments", icon: RefreshCcw },
    ...(isStatic ? [] : [{ id: "logs" as const, label: "Logs", icon: Terminal }]),
    { id: "domains", label: "Domains", icon: Globe },
    { id: "env", label: "Environment", icon: Lock },
    { id: "analytics", label: "Analytics", icon: Activity },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge variant="outline">{TYPE_LABEL[project.type] ?? project.type}</Badge>
            {active && <StatusBadge status={active.status} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {isImage && (
              <span className="flex min-w-0 items-center gap-1.5 font-mono">
                <Container className="size-3.5 shrink-0" /> <span className="truncate">{project.dockerImage}</span>
              </span>
            )}
            {repository && (
              <a href={`https://github.com/${repository.githubRepositoryName}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
                <GithubIcon className="size-3.5" /> {repository.githubRepositoryName}
              </a>
            )}
            {repository && (
              <span className="flex items-center gap-1.5">
                <GitBranch className="size-3.5" /> {repository.branch}
              </span>
            )}
            {project.framework && !isImage && <span>{project.framework}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Visit <ExternalLink />
            </a>
          </Button>
          {canDeploy && (
            <Button onClick={deploy} loading={deploying} disabled={!repository && !isImage}>
              {!deploying && <Play className="fill-current" />} {deployments.length ? "Deploy latest" : "Deploy"}
            </Button>
          )}
        </div>
      </header>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="min-h-[420px]">
        {tab === "overview" && <OverviewTab live={live} active={active} url={url} loaded={loaded} onAct={act} canDeploy={canDeploy} isImage={isImage} />}
        {tab === "deployments" && <DeploymentsTab deployments={deployments} loaded={loaded} live={live} canDeploy={canDeploy} onAct={act} onOpen={(id: string) => { setSelected(id); setTab("overview"); }} />}
        {tab === "logs" && <RuntimeLogsTab projectId={project.id} />}
        {tab === "domains" && <DomainsTab projectId={project.id} canManage={role === "admin" || role === "owner"} />}
        {tab === "env" && <EnvTab projectId={project.id} canWrite={canDeploy} runtimeOnly={isImage} />}
        {tab === "analytics" && <AnalyticsTab projectId={project.id} />}
        {tab === "settings" && <SettingsTab project={project} repository={repository} role={role} registryLogin={registryLogin ?? null} />}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
function DeploymentActions({ d, live, canDeploy, onAct }: { d: any; live: any; canDeploy: boolean; onAct: (id: string, a: "cancel" | "promote" | "redeploy") => void }) {
  if (!canDeploy) return null;
  const isLive = live?.id === d.id;
  const older = live && new Date(d.createdAt) < new Date(live.createdAt);
  return (
    <div className="flex items-center gap-2">
      {IN_FLIGHT.includes(d.status) && (
        <Button size="sm" variant="outline" onClick={() => onAct(d.id, "cancel")}>
          <XCircle /> Cancel
        </Button>
      )}
      {d.status === "READY" && !isLive && (
        <Button size="sm" variant="outline" onClick={() => onAct(d.id, "promote")}>
          <RotateCcw /> {older ? "Rollback" : "Promote"}
        </Button>
      )}
      {!IN_FLIGHT.includes(d.status) && d.status !== "ARCHIVED" && (
        <Button size="sm" variant="ghost" onClick={() => onAct(d.id, "redeploy")}>
          <RefreshCcw /> Redeploy
        </Button>
      )}
    </div>
  );
}

function OverviewTab({ live, active, url, loaded, onAct, canDeploy, isImage }: any) {
  const [lines, setLines] = useState<string[]>([]);
  const cursor = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const activeId: string | undefined = active?.id;
  const inFlight = active && IN_FLIGHT.includes(active.status);

  useEffect(() => {
    setLines([]);
    cursor.current = 0;
    stick.current = true;
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const data = await api(`/api/v1/deployments/${activeId}/logs?from=${cursor.current}`);
        if (stopped) return;
        if (data.lines.length) {
          cursor.current = data.next;
          setLines((prev) => [...prev, ...data.lines]);
        }
        if (data.done && data.lines.length === 0 && cursor.current > 0) return; // finished and fully read
      } catch {
        /* retry */
      }
      if (!stopped) timer = setTimeout(tick, inFlight ? 1200 : 3000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeId, inFlight]);

  useEffect(() => {
    if (stick.current) box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length]);

  if (!active) {
    return loaded ? (
      <EmptyState icon={Play} title="No deployments yet" description={isImage ? "Click Deploy to pull this project's Docker image and start it." : "Click Deploy to build and publish this project from its repository."} />
    ) : (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardDescription className="uppercase tracking-wider">Production</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-accent">
                {hostOf(url)} <ExternalLink className="size-3.5 text-muted-foreground" />
              </a>
              <CopyButton value={url} label="Copy URL" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            {live ? (
              <>
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="size-4" /> Live
                </span>
                <span className="font-mono">{shortSha(live.commitHash)}</span>
                <span className="max-w-xs truncate">{live.commitMessage ?? "Manual deployment"}</span>
                <span>{timeAgo(live.readyAt ?? live.createdAt)}</span>
              </>
            ) : (
              <span className="text-warning">Nothing is live yet — the first deployment is still in progress or failed.</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="uppercase tracking-wider">Selected deployment</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <StatusBadge status={active.status} />
              <span className="font-mono text-xs font-normal text-muted-foreground">{shortSha(active.commitHash)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            <p className="line-clamp-2 text-muted-foreground">{active.commitMessage ?? "Manual deployment"}</p>
            {active.errorMessage && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{active.errorMessage}</p>}
            <DeploymentActions d={active} live={live} canDeploy={canDeploy} onAct={onAct} />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Terminal className="size-4" /> build.log
            {inFlight && <Badge variant="warning" dot pulse>Live</Badge>}
          </span>
          <CopyButton value={lines.join("\n")} label="Copy log" />
        </div>
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="scroll-thin h-[460px] overflow-y-auto bg-[#0a0a0c] p-4 font-mono text-[12.5px] leading-[1.65] text-zinc-300"
        >
          {lines.length === 0 ? (
            <span className="animate-pulse text-zinc-500">Waiting for build output…</span>
          ) : (
            lines.map((line, i) => {
              const tone = /\[error\]|failed|✗/i.test(line) ? "text-red-400" : /\[(warn|detect)|warning/i.test(line) ? "text-amber-300" : /✓|\bready\b|success/i.test(line) ? "text-emerald-400" : "";
              return (
                <div key={i} className="flex gap-4 rounded-sm px-1 hover:bg-white/[0.04]">
                  <span className="w-8 shrink-0 select-none text-right text-[11px] leading-[1.9] text-zinc-600">{i + 1}</span>
                  <span className={cn("flex-1 whitespace-pre-wrap break-all", tone)}>{line}</span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

function DeploymentsTab({ deployments, loaded, live, canDeploy, onAct, onOpen }: any) {
  if (loaded && deployments.length === 0) return <EmptyState icon={RefreshCcw} title="No deployments yet" />;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y">
        {deployments.map((d: any) => (
          <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <button onClick={() => onOpen(d.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <StatusBadge status={d.status} />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{d.commitMessage ?? "Manual deployment"}</span>
                  {live?.id === d.id && <Badge variant="success">Live</Badge>}
                  {d.environment === "preview" && <Badge variant="info">Preview</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  <span className="font-mono">{shortSha(d.commitHash)}</span> · {d.branch ?? "—"} · {d.trigger.replace("_", " ")} · {timeAgo(d.createdAt)}
                </span>
              </span>
            </button>
            <DeploymentActions d={d} live={live} canDeploy={canDeploy} onAct={onAct} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RuntimeLogsTab({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Array<{ id: string; line: string }>>([]);
  const last = useRef<string | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const data = await api(`/api/v1/projects/${projectId}/runtime-logs${last.current ? `?after=${last.current}` : ""}`);
        if (data.entries.length) {
          last.current = data.last;
          setEntries((prev) => [...prev, ...data.entries].slice(-2000));
        }
      } catch {
        /* retry */
      }
      if (!stopped) timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [entries.length]);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
        <Terminal className="size-4" /> container output <Badge variant="success" dot pulse>Streaming</Badge>
      </div>
      <div ref={box} className="scroll-thin h-[560px] overflow-y-auto bg-[#0a0a0c] p-4 font-mono text-[12.5px] leading-[1.65] text-zinc-300">
        {entries.length === 0 ? (
          <span className="text-zinc-500">No output yet. Logs appear here as soon as the service prints something.</span>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={cn("whitespace-pre-wrap break-all rounded-sm px-1 hover:bg-white/[0.04]", e.line.startsWith("[stderr]") && "text-red-300")}>
              {e.line}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function DomainsTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const toast = useToast();
  const [domains, setDomains] = useState<any[] | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const load = useCallback(async () => setDomains((await api(`/api/v1/projects/${projectId}/domains`)).domains), [projectId]);
  useEffect(() => {
    load().catch(() => setDomains([]));
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error("Domain action failed", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const tone = (s: string) => (s === "active" ? "success" : s === "verified" ? "info" : "warning");
  const label = (s: string) => (s === "active" ? "Active" : s === "verified" ? "Waiting for DNS" : "Pending DNS");

  return (
    <div className="space-y-5">
      {canManage && (
        <Card>
          <form
            className="flex flex-col gap-3 p-4 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("add", async () => { await api(`/api/v1/projects/${projectId}/domains`, { method: "POST", body: JSON.stringify({ domain: value }) }); setValue(""); }, "Domain added — configure the CNAME / A record below");
            }}
          >
            <Input placeholder="app.example.com" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Domain" />
            <Button type="submit" loading={busy === "add"} disabled={!value.trim()}>
              Add domain
            </Button>
          </form>
        </Card>
      )}

      {domains?.length === 0 && <EmptyState icon={Globe} title="No custom domains" description="Add a domain you own. We'll show the DNS records to create, then issue HTTPS automatically." />}

      {domains?.map((d) => (
        <Card key={d.domain}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="flex items-center gap-3">
              <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold hover:text-accent">
                {d.domain}
              </a>
              <Badge variant={tone(d.status) as any} dot>
                {label(d.status)}
              </Badge>
              {d.redirectTo && <span className="text-xs text-muted-foreground">→ {d.redirectTo}</span>}
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" loading={busy === d.domain} onClick={() => run(d.domain, () => api(`/api/v1/projects/${projectId}/domains/${encodeURIComponent(d.domain)}/verify`, { method: "POST", body: "{}" }))}>
                  <RefreshCcw /> Verify DNS
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${d.domain}`} onClick={() => setRemoving(d.domain)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </CardHeader>
          {d.status !== "active" && (
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/60 text-muted-foreground">
                    <tr>{["Type", "Name", "Value", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    {d.instructions.map((r: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-2"><Badge variant="outline">{r.type}</Badge></td>
                        <td className="px-3 py-2"><span className="break-all">{r.host}</span> <CopyButton value={r.host} /></td>
                        <td className="px-3 py-2"><span className="break-all">{r.value}</span> <CopyButton value={r.value} /></td>
                        <td className="px-3 py-2 font-sans text-muted-foreground">{r.purpose === "ownership" ? "Proves you own the domain" : "Sends traffic to Orb"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.lastError && <p className="mt-3 text-xs text-warning">{d.lastError}</p>}
              <p className="mt-2 text-xs text-muted-foreground">DNS changes can take a few minutes. We re-check every 5 minutes and issue the HTTPS certificate as soon as the domain is verified.</p>
            </CardContent>
          )}
        </Card>
      ))}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing}?`}
        description="Visitors will no longer reach this project on that domain."
        confirmLabel="Remove domain"
        destructive
        onConfirm={() => run("rm", () => api(`/api/v1/projects/${projectId}/domains/${encodeURIComponent(removing!)}`, { method: "DELETE" }), "Domain removed")}
      />
    </div>
  );
}

function EnvTab({ projectId, canWrite, runtimeOnly = false }: { projectId: string; canWrite: boolean; runtimeOnly?: boolean }) {
  const toast = useToast();
  const [vars, setVars] = useState<any[] | null>(null);
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  const [target, setTarget] = useState("all");
  // Docker image projects have no build step, so their variables are always runtime variables.
  const [scopeChoice, setScope] = useState("both");
  const scope = runtimeOnly ? "runtime" : scopeChoice;
  const [secret, setSecret] = useState(true);
  const [bulk, setBulk] = useState("");
  const [reveal, setReveal] = useState<Set<string>>(new Set());
  const load = useCallback(async () => setVars((await api(`/api/v1/projects/${projectId}/env`)).envVars), [projectId]);
  useEffect(() => {
    load().catch(() => setVars([]));
  }, [load]);

  const save = async (body: object) => {
    try {
      const data = await api(`/api/v1/projects/${projectId}/env`, { method: "PUT", body: JSON.stringify(body) });
      toast.success("Saved", data.skipped?.length ? `Skipped invalid keys: ${data.skipped.join(", ")}` : "Redeploy to apply the changes.");
      await load();
      return true;
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
      return false;
    }
  };

  return (
    <div className="space-y-5">
      {canWrite && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
              <Input className="font-mono text-[13px]" placeholder="KEY" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Key" />
              <Input className="font-mono text-[13px]" placeholder="value" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Value" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select className="w-auto" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Environment">
                <option value="all">All environments</option>
                <option value="production">Production</option>
                <option value="preview">Preview</option>
              </Select>
              {runtimeOnly ? (
                <Badge variant="outline">Passed to the container at runtime</Badge>
              ) : (
                <Select className="w-auto" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Used in">
                  <option value="both">Build + runtime</option>
                  <option value="build">Build only</option>
                  <option value="runtime">Runtime only</option>
                </Select>
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <Switch checked={secret} onCheckedChange={setSecret} label="Sensitive" /> Sensitive
              </label>
              <Button className="ml-auto" disabled={!key || !val} onClick={async () => { if (await save({ envVars: [{ key, value: val, target, scope, isSecret: secret }] })) { setKey(""); setVal(""); } }}>
                Save variable
              </Button>
            </div>
            <details className="group text-sm">
              <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">Import from a .env file</summary>
              <Textarea className="mt-3" rows={5} placeholder={"API_URL=https://example.com\nSECRET=abc"} value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <Button className="mt-2" size="sm" variant="outline" disabled={!bulk.trim()} onClick={async () => { if (await save({ dotenv: bulk, target, scope, isSecret: secret })) setBulk(""); }}>
                Import
              </Button>
            </details>
          </CardContent>
        </Card>
      )}

      {vars?.length === 0 ? (
        <EmptyState icon={Lock} title="No environment variables" description="Values are encrypted at rest and applied on the next deployment." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {vars?.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] font-medium">{v.key}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{v.isSecret ? "•••••••••••• (sensitive — write only)" : reveal.has(v.id) ? v.value : "••••••••"}</p>
                </div>
                <Badge variant="outline">{v.target}</Badge>
                <Badge variant="outline" className="hidden sm:inline-flex">{v.scope}</Badge>
                {!v.isSecret && (
                  <Button size="icon-sm" variant="ghost" aria-label={reveal.has(v.id) ? "Hide value" : "Show value"} onClick={() => setReveal((s) => { const n = new Set(s); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n; })}>
                    {reveal.has(v.id) ? <EyeOff /> : <Eye />}
                  </Button>
                )}
                {canWrite && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${v.key}`} onClick={async () => { await api(`/api/v1/projects/${projectId}/env/${v.id}`, { method: "DELETE" }); toast.success(`${v.key} deleted`); void load(); }}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AnalyticsTab({ projectId }: { projectId: string }) {
  const [range, setRange] = useState("24h");
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api(`/api/v1/projects/${projectId}/analytics?range=${range}`).then(setData).catch(() => setData({ series: [], totals: {} }));
  }, [projectId, range]);
  const series = useMemo(
    () => (data?.series ?? []).map((p: any) => ({ ...p, label: new Date(p.bucket).toLocaleString([], range === "24h" ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" }) })),
    [data, range],
  );
  const t = data?.totals ?? {};
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Segmented options={[{ id: "24h", label: "24 hours" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }]} value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Requests" value={formatNumber(t.requests ?? 0)} />
        <StatCard label="Bandwidth" value={formatBytes(t.bytesOut ?? 0)} />
        <StatCard label="Avg. latency" value={`${t.avgMs ?? 0} ms`} />
        <StatCard label="Server errors (5xx)" value={formatNumber(t.s5xx ?? 0)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>Counted at the edge, rolled up hourly. Data appears about a minute after traffic arrives.</CardDescription>
        </CardHeader>
        <CardContent className="h-72 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ left: -12, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="req" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--foreground)" }} />
              <Area type="monotone" dataKey="requests" stroke="var(--accent)" strokeWidth={2} fill="url(#req)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ project, repository, role, registryLogin }: { project: any; repository: any; role: string; registryLogin: RegistryLogin | null }) {
  const router = useRouter();
  const toast = useToast();
  const isImage = project.sourceType === "image";
  const [registry, setRegistry] = useState({ username: "", password: "", remove: false });
  const [form, setForm] = useState({
    name: project.name as string,
    image: (project.dockerImage ?? "") as string,
    rootDirectory: (project.rootDirectory ?? "") as string,
    installCommand: (project.installCommand ?? "") as string,
    buildCommand: (project.buildCommand ?? "") as string,
    startCommand: (project.startCommand ?? "") as string,
    outputDirectory: (project.outputDirectory ?? "") as string,
    port: project.port as number,
    healthCheckPath: project.healthCheckPath as string,
    instancePlan: project.instancePlan as string,
    instanceCount: project.instanceCount as number,
    autoDeploy: project.autoDeploy as boolean,
    previewDeployments: project.previewDeployments as boolean,
    branch: (repository?.branch ?? "main") as string,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = role !== "viewer";
  const isStatic = project.type === "static";
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const imageProblem = isImage ? imageReferenceError(form.image) : null;
  const imageHost = isImage ? parseImageReference(form.image)?.registry : undefined;
  // A saved login only ever goes to the registry it was saved for.
  const loginMismatch = Boolean(registryLogin && imageHost && normalizeRegistryHost(registryLogin.host) !== imageHost);
  const registryIncomplete = !registry.remove && Boolean(registry.username.trim()) !== Boolean(registry.password);

  const save = async () => {
    setSaving(true);
    try {
      let body: Record<string, unknown>;
      if (isImage) {
        // Image projects have no repository, build or branch: only what the container needs.
        body = {
          name: form.name,
          image: form.image.trim(),
          startCommand: form.startCommand.trim(),
          instancePlan: form.instancePlan,
          instanceCount: Number(form.instanceCount),
        };
        if (project.type === "web_service") {
          body.port = Number(form.port) || 0; // 0 = detect from the image
          body.healthCheckPath = form.healthCheckPath;
        }
        if (registry.remove) body.registry = null;
        else if (registry.username.trim() && registry.password) body.registry = { username: registry.username.trim(), password: registry.password };
      } else {
        body = { ...form, port: Number(form.port), instanceCount: Number(form.instanceCount) };
        delete body.image;
        for (const k of ["installCommand", "buildCommand", "startCommand", "outputDirectory"]) if (body[k] === "") delete body[k];
        if (isStatic) for (const k of ["port", "healthCheckPath", "instancePlan", "instanceCount", "startCommand"]) delete body[k];
      }
      await api(`/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success("Settings saved", "They apply to the next deployment.");
      setRegistry({ username: "", password: "", remove: false });
      router.refresh();
    } catch (e) {
      toast.error("Couldn't save settings", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Source and build configuration. Changes apply to the next deployment.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name"><Input disabled={!editable} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          {isImage ? (
            <>
              <Field label="Docker image" hint="Deploy pulls this image again, so a moved tag such as latest is picked up.">
                <Input disabled={!editable} className="font-mono text-[13px]" value={form.image} onChange={(e) => set("image", e.target.value)} spellCheck={false} aria-invalid={Boolean(imageProblem)} />
                {imageProblem && <p className="text-xs text-destructive">{imageProblem}</p>}
              </Field>
              <Field label={project.type === "cron" ? "Command" : "Command override"} hint="Optional. Replaces the image's default command." className="sm:col-span-2">
                <Input disabled={!editable} className="font-mono text-[13px]" value={form.startCommand} onChange={(e) => set("startCommand", e.target.value)} placeholder="Image default" />
              </Field>
            </>
          ) : (
            <>
              <Field label="Production branch"><Input disabled={!editable} value={form.branch} onChange={(e) => set("branch", e.target.value)} /></Field>
              <Field label="Root directory"><Input disabled={!editable} value={form.rootDirectory} onChange={(e) => set("rootDirectory", e.target.value)} placeholder="(repository root)" /></Field>
              <Field label="Install command"><Input disabled={!editable} className="font-mono text-[13px]" value={form.installCommand} onChange={(e) => set("installCommand", e.target.value)} /></Field>
              <Field label="Build command"><Input disabled={!editable} className="font-mono text-[13px]" value={form.buildCommand} onChange={(e) => set("buildCommand", e.target.value)} /></Field>
              {isStatic ? (
                <Field label="Output directory"><Input disabled={!editable} className="font-mono text-[13px]" value={form.outputDirectory} onChange={(e) => set("outputDirectory", e.target.value)} /></Field>
              ) : (
                <Field label="Start command"><Input disabled={!editable} className="font-mono text-[13px]" value={form.startCommand} onChange={(e) => set("startCommand", e.target.value)} /></Field>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {isImage && (
        <Card>
          <CardHeader>
            <CardTitle>Registry login</CardTitle>
            <CardDescription>
              {registryLogin && !registry.remove
                ? loginMismatch
                  ? `The saved login (${registryLogin.username}) is for ${registryLogin.host}, so it is not used for this image. Enter a login for ${imageHost ?? "this registry"} to replace it.`
                  : `Pulling from ${registryLogin.host} as ${registryLogin.username}. The password is stored encrypted and can't be shown — enter both fields to replace it.`
                : "Only needed for private images or to avoid Docker Hub's anonymous pull limit."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Username"><Input disabled={!editable || registry.remove} value={registry.username} onChange={(e) => setRegistry((r) => ({ ...r, username: e.target.value }))} autoComplete="off" /></Field>
            <Field label="Password or access token"><Input disabled={!editable || registry.remove} type="password" value={registry.password} onChange={(e) => setRegistry((r) => ({ ...r, password: e.target.value }))} autoComplete="new-password" /></Field>
            {registryLogin && editable && (
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <Switch checked={registry.remove} onCheckedChange={(v) => setRegistry((r) => ({ ...r, remove: v }))} label="Remove registry login" /> Remove the saved login
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {!isStatic && (
        <Card>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
            <CardDescription>Port, health checks and capacity.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {project.type === "web_service" && (
              <>
                <Field label="Port" hint={isImage ? "Leave empty to use the port the image declares (EXPOSE)." : undefined}>
                  <Input disabled={!editable} type="number" value={form.port || ""} placeholder={isImage ? "Auto-detect" : undefined} onChange={(e) => set("port", Number(e.target.value))} />
                </Field>
                <Field label="Health check path"><Input disabled={!editable} className="font-mono text-[13px]" value={form.healthCheckPath} onChange={(e) => set("healthCheckPath", e.target.value)} /></Field>
              </>
            )}
            <Field label="Instance size">
              <Select disabled={!editable} value={form.instancePlan} onChange={(e) => set("instancePlan", e.target.value)}>
                <option value="free">Free — 0.1 vCPU / 256 MB</option>
                <option value="starter">Starter — 0.5 vCPU / 512 MB</option>
                <option value="standard">Standard — 1 vCPU / 2 GB</option>
                <option value="pro">Pro — 2 vCPU / 4 GB</option>
              </Select>
            </Field>
            <Field label="Instances" hint="Horizontal scale. Limited by your plan.">
              <Input disabled={!editable} type="number" min={1} value={form.instanceCount} onChange={(e) => set("instanceCount", Number(e.target.value))} />
            </Field>
          </CardContent>
        </Card>
      )}

      {!isImage && (
      <Card>
        <CardHeader>
          <CardTitle>Git</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-6">
            <span>
              <span className="block text-sm font-medium">Auto-deploy</span>
              <span className="text-[13px] text-muted-foreground">Deploy to production on every push to <code className="font-mono">{form.branch}</code>.</span>
            </span>
            <Switch checked={form.autoDeploy} onCheckedChange={(v) => set("autoDeploy", v)} disabled={!editable} label="Auto-deploy" />
          </label>
          <label className="flex items-start justify-between gap-6">
            <span>
              <span className="block text-sm font-medium">Preview deployments</span>
              <span className="text-[13px] text-muted-foreground">Build every other branch to its own URL (Pro plan and above).</span>
            </span>
            <Switch checked={form.previewDeployments} onCheckedChange={(v) => set("previewDeployments", v)} disabled={!editable} label="Preview deployments" />
          </label>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={save} loading={saving} disabled={!editable}>
            Save changes
          </Button>
        </CardFooter>
      </Card>
      )}

      {isImage && (
        <div className="flex items-center justify-end gap-3">
          {registryIncomplete && <span className="text-xs text-warning">Enter both the registry username and password.</span>}
          <Button onClick={save} loading={saving} disabled={!editable || Boolean(imageProblem) || !form.image.trim() || registryIncomplete}>
            Save changes
          </Button>
        </div>
      )}

      {(role === "admin" || role === "owner") && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>Deleting a project stops all instances and permanently removes its deployments, domains and environment variables.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-end">
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete project
            </Button>
          </CardFooter>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${project.name}?`}
        description="This cannot be undone."
        confirmLabel="Delete project"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/v1/projects/${project.id}`, { method: "DELETE" });
            toast.success("Project deleted");
            router.push("/dashboard/projects");
            router.refresh();
          } catch (e) {
            toast.error("Couldn't delete project", errorMessage(e));
          }
        }}
      />
    </div>
  );
}

