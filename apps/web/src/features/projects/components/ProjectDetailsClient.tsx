"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, Box, CheckCircle2, Code, Copy, ExternalLink, GitBranch, Globe, Lock, Play, RefreshCcw,
  RotateCcw, Settings as SettingsIcon, Terminal, Trash2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tab = "overview" | "deployments" | "logs" | "domains" | "env" | "analytics" | "settings";
const TABS: Array<{ id: Tab; label: string; icon: any }> = [
  { id: "overview", label: "Overview", icon: Box },
  { id: "deployments", label: "Deployments", icon: RefreshCcw },
  { id: "logs", label: "Runtime Logs", icon: Terminal },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "env", label: "Environment", icon: Lock },
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const IN_FLIGHT = ["QUEUED", "BUILDING", "DEPLOYING"];
const TYPE_LABEL: Record<string, string> = { static: "Static Site", web_service: "Web Service", worker: "Background Worker", cron: "Cron Job" };
const card = "rounded-[16px] border border-white/10 bg-white/[0.02]";
const inputCls = "h-9 bg-[#050505] border-white/10 rounded-lg text-[13px]";

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "READY" ? "bg-green-500" : status === "FAILED" ? "bg-red-500" : status === "CANCELED" || status === "ARCHIVED" ? "bg-zinc-500" : "bg-yellow-500 animate-pulse";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function CopyButton({ value }: { value: string }) {
  return (
    <button type="button" onClick={() => navigator.clipboard?.writeText(value)} className="text-muted-foreground hover:text-white" title="Copy">
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function useDeployments(projectId: string) {
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const data = await api(`/api/v1/projects/${projectId}/deployments`);
      setDeployments(data.deployments);
    } catch {
      /* keep stale data */
    } finally {
      setLoaded(true);
    }
  }, [projectId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const busy = deployments.some((d) => IN_FLIGHT.includes(d.status));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, refresh]);
  return { deployments, refresh, loaded };
}

export function ProjectDetailsClient({ project, repository, role }: { project: any; repository: any; role: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { deployments, refresh, loaded } = useDeployments(project.id);
  const canDeploy = role !== "viewer";
  const base = process.env.NEXT_PUBLIC_BASE_DOMAIN || "localhost";
  const scheme = base === "localhost" ? "http" : "https";
  const projectUrl = `${scheme}://${project.slug}.${base}`;
  const isStatic = project.type === "static";

  const live = deployments.find((d) => d.id === project.currentDeploymentId) ?? deployments.find((d) => d.status === "READY" && d.environment === "production");
  const active = deployments.find((d) => d.id === selected) ?? deployments[0];

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      const data = await api(`/api/v1/projects/${project.id}/deployments`, { method: "POST", body: "{}" });
      setSelected(data.deployment.id);
      setTab("overview");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeploying(false);
    }
  };

  const act = async (id: string, action: "cancel" | "promote" | "redeploy") => {
    setError(null);
    try {
      const data = await api(`/api/v1/deployments/${id}/${action}`, { method: "POST", body: "{}" });
      if (action === "redeploy") setSelected(data.deployment.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-20 text-white font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex flex-col">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/5 text-zinc-300 border border-white/10 uppercase tracking-wider">{TYPE_LABEL[project.type] ?? project.type}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Code className="h-3.5 w-3.5" /> {repository?.githubRepositoryName ?? "—"}</span>
            <span className="h-1 w-1 rounded-full bg-white/20" />
            <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> {repository?.branch ?? "main"}</span>
            {project.framework && (<><span className="h-1 w-1 rounded-full bg-white/20" /><span>{project.framework}</span></>)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="h-9 rounded-[8px] bg-white/5 border-white/10 text-xs" asChild>
            <a href={projectUrl} target="_blank" rel="noopener noreferrer">Visit <ExternalLink className="ml-2 h-3 w-3" /></a>
          </Button>
          {canDeploy && (
            <Button onClick={deploy} disabled={deploying || !repository} className="h-9 rounded-[8px] bg-white text-black hover:bg-white/90 font-medium px-4 text-xs">
              {deploying ? <RefreshCcw className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5 fill-current" />}
              {deployments.length ? "Deploy latest" : "Deploy"}
            </Button>
          )}
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm px-4 py-2.5">{error}</div>}

      <div className="border-b border-white/10">
        <div className="flex overflow-x-auto gap-6">
          {TABS.filter((t) => !(t.id === "logs" && isStatic)).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`relative py-3 text-[13px] font-medium whitespace-nowrap flex items-center gap-2 ${tab === t.id ? "text-white" : "text-muted-foreground hover:text-white"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
              {tab === t.id && <motion.div layoutId="active-tab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-white" />}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === "overview" && <OverviewTab live={live} active={active} projectUrl={projectUrl} loaded={loaded} onAct={act} canDeploy={canDeploy} />}
            {tab === "deployments" && <DeploymentsTab deployments={deployments} live={live} canDeploy={canDeploy} onAct={act} onOpen={(id: string) => { setSelected(id); setTab("overview"); }} />}
            {tab === "logs" && <RuntimeLogsTab projectId={project.id} />}
            {tab === "domains" && <DomainsTab projectId={project.id} canManage={role === "admin" || role === "owner"} />}
            {tab === "env" && <EnvTab projectId={project.id} canWrite={canDeploy} />}
            {tab === "analytics" && <AnalyticsTab projectId={project.id} />}
            {tab === "settings" && <SettingsTab project={project} repository={repository} role={role} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
function DeploymentActions({ d, live, canDeploy, onAct }: { d: any; live: any; canDeploy: boolean; onAct: (id: string, a: "cancel" | "promote" | "redeploy") => void }) {
  if (!canDeploy) return null;
  const isLive = live?.id === d.id;
  return (
    <div className="flex items-center gap-2">
      {IN_FLIGHT.includes(d.status) && (
        <Button size="sm" variant="outline" className="h-8 text-xs bg-white/5 border-white/10" onClick={() => onAct(d.id, "cancel")}><XCircle className="mr-1.5 h-3.5 w-3.5" />Cancel</Button>
      )}
      {d.status === "READY" && !isLive && (
        <Button size="sm" variant="outline" className="h-8 text-xs bg-white/5 border-white/10" onClick={() => onAct(d.id, "promote")}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />{live && new Date(d.createdAt) < new Date(live.createdAt) ? "Rollback to this" : "Promote"}
        </Button>
      )}
      {!IN_FLIGHT.includes(d.status) && (
        <Button size="sm" variant="outline" className="h-8 text-xs bg-white/5 border-white/10" onClick={() => onAct(d.id, "redeploy")}><RefreshCcw className="mr-1.5 h-3.5 w-3.5" />Redeploy</Button>
      )}
    </div>
  );
}

function OverviewTab({ live, active, projectUrl, loaded, onAct, canDeploy }: any) {
  const [lines, setLines] = useState<string[]>([]);
  const cursor = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const activeId: string | undefined = active?.id;
  const done = active && !IN_FLIGHT.includes(active.status);

  useEffect(() => {
    setLines([]);
    cursor.current = 0;
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const data = await api(`/api/v1/deployments/${activeId}/logs?from=${cursor.current}`);
        if (stopped) return;
        if (data.lines.length) {
          cursor.current = data.next;
          setLines((prev) => [...prev, ...data.lines]);
        }
        if (data.done && data.lines.length === 0) return;
      } catch {
        /* retry */
      }
      if (!stopped) timer = setTimeout(tick, done ? 4000 : 1200);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeId, done]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length]);

  if (loaded && !active) {
    return <div className={`${card} p-10 text-center text-muted-foreground text-sm`}>No deployments yet. Click <b className="text-white">Deploy</b> to build and publish this project.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={`${card} p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4`}>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Production</span>
          <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline flex items-center gap-2">
            {projectUrl.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
          {!live && <span className="text-xs text-yellow-400">Nothing is live yet.</span>}
        </div>
        {live && (
          <div className="flex items-center gap-5 text-sm">
            <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Ready</span>
            <span className="font-mono text-xs text-muted-foreground">{live.commitHash?.slice(0, 7) ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(live.readyAt ?? live.createdAt))} ago</span>
          </div>
        )}
      </div>

      {active && (
        <div className={`${card} p-5 flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <StatusDot status={active.status} />
              <span className="text-sm font-medium">{active.status.charAt(0) + active.status.slice(1).toLowerCase()}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-muted-foreground">{active.environment}</span>
              <span className="text-sm text-zinc-300 truncate max-w-[420px]">{active.commitMessage ?? "Manual deployment"}</span>
            </div>
            <DeploymentActions d={active} live={live} canDeploy={canDeploy} onAct={onAct} />
          </div>
          {active.errorMessage && <p className="text-sm text-red-400">{active.errorMessage}</p>}
        </div>
      )}

      <div className="rounded-[16px] border border-white/10 bg-[#050505] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <span className="flex items-center gap-3 text-xs font-mono text-muted-foreground"><Terminal className="h-4 w-4" /> build.log</span>
          <CopyButton value={lines.join("\n")} />
        </div>
        <div ref={box} className="p-4 font-mono text-[12.5px] leading-[1.6] text-gray-300 h-[560px] overflow-y-auto">
          {lines.length === 0 ? (
            <span className="text-muted-foreground animate-pulse">Waiting for logs…</span>
          ) : (
            lines.map((line, i) => {
              const color = /\[error\]|failed|✗/i.test(line) ? "text-red-400" : /\[warn|warning/i.test(line) ? "text-yellow-400" : /✓|ready|success/i.test(line) ? "text-green-400" : "text-gray-300";
              return (
                <div key={i} className="flex gap-4 hover:bg-white/[0.02] px-2 rounded-sm">
                  <span className="text-white/20 select-none text-[11px] pt-0.5">{String(i + 1).padStart(4, "0")}</span>
                  <span className={`${color} whitespace-pre-wrap break-all flex-1`}>{line}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function DeploymentsTab({ deployments, live, canDeploy, onAct, onOpen }: any) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm text-left">
        <thead className="border-b border-white/10 text-muted-foreground text-xs uppercase tracking-wider">
          <tr>{["Status", "Commit", "Branch", "Created", ""].map((h) => <th key={h} className="px-5 py-3.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {deployments.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No deployments yet.</td></tr>}
          {deployments.map((d: any) => (
            <tr key={d.id} className="hover:bg-white/[0.02]">
              <td className="px-5 py-3.5">
                <button className="flex items-center gap-2 capitalize" onClick={() => onOpen(d.id)}>
                  <StatusDot status={d.status} /> {d.status.toLowerCase()}
                  {live?.id === d.id && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">LIVE</span>}
                </button>
              </td>
              <td className="px-5 py-3.5 max-w-[320px]">
                <div className="truncate">{d.commitMessage ?? "Manual deployment"}</div>
                <div className="text-xs font-mono text-muted-foreground">{d.commitHash?.slice(0, 7) ?? "—"} · {d.trigger.replace("_", " ")}</div>
              </td>
              <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{d.branch ?? "—"}{d.environment === "preview" && <span className="ml-2 text-yellow-400">preview</span>}</td>
              <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(d.createdAt))} ago</td>
              <td className="px-5 py-3.5"><DeploymentActions d={d} live={live} canDeploy={canDeploy} onAct={onAct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [entries.length]);
  return (
    <div className="rounded-[16px] border border-white/10 bg-[#050505] overflow-hidden">
      <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02] text-xs font-mono text-muted-foreground flex items-center gap-3"><Terminal className="h-4 w-4" /> live container output</div>
      <div ref={box} className="p-4 font-mono text-[12.5px] leading-[1.6] text-gray-300 h-[600px] overflow-y-auto">
        {entries.length === 0 ? <span className="text-muted-foreground">No runtime output yet. Logs appear here as soon as the service prints something.</span> : entries.map((e) => (
          <div key={e.id} className={`whitespace-pre-wrap break-all px-2 ${e.line.startsWith("[stderr]") ? "text-red-300" : ""}`}>{e.line}</div>
        ))}
      </div>
    </div>
  );
}

function DomainsTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [domains, setDomains] = useState<any[]>([]);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const data = await api(`/api/v1/projects/${projectId}/domains`);
    setDomains(data.domains);
  }, [projectId]);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  const badge = (s: string) => s === "active" ? "bg-green-500/10 text-green-400 border-green-500/20" : s === "verified" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  const label = (s: string) => s === "active" ? "Active" : s === "verified" ? "Verified · waiting for DNS" : "Pending verification";

  return (
    <div className="flex flex-col gap-5">
      {canManage && (
        <form className={`${card} p-5 flex gap-3`} onSubmit={(e) => { e.preventDefault(); run("add", async () => { await api(`/api/v1/projects/${projectId}/domains`, { method: "POST", body: JSON.stringify({ domain: value }) }); setValue(""); }); }}>
          <Input className={inputCls} placeholder="app.example.com" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" disabled={!value || busy === "add"} className="h-9 bg-white text-black hover:bg-white/90 text-xs">Add domain</Button>
        </form>
      )}
      {msg && <div className="text-sm text-red-300">{msg}</div>}
      {domains.length === 0 && <div className={`${card} p-8 text-center text-sm text-muted-foreground`}>No custom domains. Add one, then create the DNS records shown below.</div>}
      {domains.map((d) => (
        <div key={d.domain} className={`${card} p-5 flex flex-col gap-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <a className="font-medium hover:underline" href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer">{d.domain}</a>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badge(d.status)}`}>{label(d.status)}</span>
              {d.redirectTo && <span className="text-xs text-muted-foreground">→ redirects to {d.redirectTo}</span>}
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs bg-white/5 border-white/10" disabled={busy === d.domain} onClick={() => run(d.domain, async () => { await api(`/api/v1/projects/${projectId}/domains/${encodeURIComponent(d.domain)}/verify`, { method: "POST", body: "{}" }); })}>
                  <RefreshCcw className={`mr-1.5 h-3.5 w-3.5 ${busy === d.domain ? "animate-spin" : ""}`} />Verify DNS
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs bg-white/5 border-white/10 text-red-300" onClick={() => confirm(`Remove ${d.domain}?`) && run(d.domain, async () => { await api(`/api/v1/projects/${projectId}/domains/${encodeURIComponent(d.domain)}`, { method: "DELETE" }); })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          {d.status !== "active" && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr>{["Type", "Name / Host", "Value", "Purpose"].map((h) => <th key={h} className="text-left py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody className="font-mono">
                  {d.instructions.map((r: any, i: number) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="py-2 pr-4">{r.type}</td>
                      <td className="py-2 pr-4"><span className="mr-2">{r.host}</span><CopyButton value={r.host} /></td>
                      <td className="py-2 pr-4"><span className="mr-2 break-all">{r.value}</span><CopyButton value={r.value} /></td>
                      <td className="py-2 text-muted-foreground font-sans">{r.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.lastError && <p className="text-xs text-yellow-400 mt-3">{d.lastError}</p>}
              <p className="text-xs text-muted-foreground mt-2">DNS changes can take a few minutes. We re-check automatically every 5 minutes; a TLS certificate is issued as soon as the domain is verified.</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EnvTab({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const [vars, setVars] = useState<any[]>([]);
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  const [target, setTarget] = useState("all");
  const [scope, setScope] = useState("both");
  const [secret, setSecret] = useState(true);
  const [bulk, setBulk] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setVars((await api(`/api/v1/projects/${projectId}/env`)).envVars), [projectId]);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const save = async (body: object) => {
    setMsg(null);
    try {
      const data = await api(`/api/v1/projects/${projectId}/env`, { method: "PUT", body: JSON.stringify(body) });
      if (data.skipped?.length) setMsg(`Skipped invalid keys: ${data.skipped.join(", ")}`);
      else setMsg("Saved. Redeploy to apply the changes.");
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div className="flex flex-col gap-5">
      {canWrite && (
        <div className={`${card} p-5 flex flex-col gap-4`}>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto_auto_auto] gap-3">
            <Input className={`${inputCls} font-mono`} placeholder="KEY" value={key} onChange={(e) => setKey(e.target.value)} />
            <Input className={`${inputCls} font-mono`} placeholder="value" value={val} onChange={(e) => setVal(e.target.value)} />
            <select className={`${inputCls} border px-2`} value={target} onChange={(e) => setTarget(e.target.value)}><option value="all">All environments</option><option value="production">Production</option><option value="preview">Preview</option></select>
            <select className={`${inputCls} border px-2`} value={scope} onChange={(e) => setScope(e.target.value)}><option value="both">Build + runtime</option><option value="build">Build only</option><option value="runtime">Runtime only</option></select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Sensitive</label>
          </div>
          <div className="flex gap-3">
            <Button className="h-9 bg-white text-black hover:bg-white/90 text-xs" disabled={!key || !val} onClick={async () => { await save({ envVars: [{ key, value: val, target, scope, isSecret: secret }] }); setKey(""); setVal(""); }}>Save variable</Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Paste a .env file</summary>
            <textarea className="mt-3 w-full h-32 bg-[#050505] border border-white/10 rounded-lg p-3 font-mono text-xs" placeholder={"API_URL=https://example.com\nSECRET=abc"} value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <Button className="mt-2 h-8 text-xs" variant="outline" disabled={!bulk.trim()} onClick={async () => { await save({ dotenv: bulk, target, scope, isSecret: secret }); setBulk(""); }}>Import</Button>
          </details>
        </div>
      )}
      {msg && <div className="text-sm text-zinc-300">{msg}</div>}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs uppercase tracking-wider border-b border-white/10"><tr>{["Key", "Value", "Environment", "Used in", ""].map((h) => <th key={h} className="text-left px-5 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-white/5">
            {vars.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No environment variables.</td></tr>}
            {vars.map((v) => (
              <tr key={v.id}>
                <td className="px-5 py-3 font-mono">{v.key}</td>
                <td className="px-5 py-3 font-mono text-muted-foreground max-w-[280px] truncate">{v.isSecret ? "•••••••• (sensitive)" : v.value}</td>
                <td className="px-5 py-3 text-xs">{v.target}</td>
                <td className="px-5 py-3 text-xs">{v.scope}</td>
                <td className="px-5 py-3 text-right">{canWrite && <button className="text-muted-foreground hover:text-red-400" onClick={async () => { await api(`/api/v1/projects/${projectId}/env/${v.id}`, { method: "DELETE" }); load(); }}><Trash2 className="h-4 w-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsTab({ projectId }: { projectId: string }) {
  const [range, setRange] = useState("24h");
  const [data, setData] = useState<any>(null);
  useEffect(() => { api(`/api/v1/projects/${projectId}/analytics?range=${range}`).then(setData).catch(() => undefined); }, [projectId, range]);
  const series = useMemo(() => (data?.series ?? []).map((p: any) => ({ ...p, label: new Date(p.bucket).toLocaleString([], range === "24h" ? { hour: "2-digit" } : { month: "short", day: "numeric" }) })), [data, range]);
  const t = data?.totals;
  const stat = (title: string, value: string) => <div className={`${card} p-5`}><div className="text-xs text-muted-foreground">{title}</div><div className="text-2xl font-semibold mt-1">{value}</div></div>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">{["24h", "7d", "30d"].map((r) => <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-md text-xs border ${range === r ? "bg-white text-black border-white" : "border-white/10 text-muted-foreground"}`}>{r}</button>)}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stat("Requests", (t?.requests ?? 0).toLocaleString())}
        {stat("Bandwidth", `${((t?.bytesOut ?? 0) / 1024 / 1024).toFixed(1)} MB`)}
        {stat("Avg latency", `${t?.avgMs ?? 0} ms`)}
        {stat("5xx errors", (t?.s5xx ?? 0).toLocaleString())}
      </div>
      <div className={`${card} p-5 h-[320px]`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} width={40} />
            <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="requests" stroke="#4F7CFF" fill="rgba(79,124,255,0.15)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Counted at the edge, rolled up hourly. Data appears about a minute after traffic arrives.</p>
    </div>
  );
}

function SettingsTab({ project, repository, role }: { project: any; repository: any; role: string }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: project.name,
    rootDirectory: project.rootDirectory ?? "",
    installCommand: project.installCommand ?? "",
    buildCommand: project.buildCommand ?? "",
    startCommand: project.startCommand ?? "",
    outputDirectory: project.outputDirectory ?? "",
    port: project.port,
    healthCheckPath: project.healthCheckPath,
    instancePlan: project.instancePlan,
    instanceCount: project.instanceCount,
    autoDeploy: project.autoDeploy,
    previewDeployments: project.previewDeployments,
    branch: repository?.branch ?? "main",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = role !== "viewer";
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const isStatic = project.type === "static";

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const body: any = { ...form, rootDirectory: form.rootDirectory, port: Number(form.port), instanceCount: Number(form.instanceCount) };
      for (const k of ["installCommand", "buildCommand", "startCommand", "outputDirectory"]) if (body[k] === "") delete body[k];
      if (isStatic) { delete body.port; delete body.healthCheckPath; delete body.instancePlan; delete body.instanceCount; delete body.startCommand; }
      await api(`/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg("Saved. New settings apply to the next deployment.");
    } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  };

  const field = (label: string, key: string, props: any = {}) => (
    <div className="space-y-1.5"><label className="text-xs text-muted-foreground">{label}</label><Input disabled={!editable} className={`${inputCls} font-mono`} value={(form as any)[key]} onChange={(e) => set(key, e.target.value)} {...props} /></div>
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className={`${card} p-6 grid grid-cols-1 md:grid-cols-2 gap-5`}>
        {field("Project name", "name")}
        {field("Production branch", "branch")}
        {field("Root directory", "rootDirectory", { placeholder: "(repository root)" })}
        {field("Install command", "installCommand")}
        {field("Build command", "buildCommand")}
        {isStatic ? field("Output directory", "outputDirectory") : field("Start command", "startCommand")}
        {!isStatic && (<>
          {field("Port", "port", { type: "number" })}
          {field("Health check path", "healthCheckPath")}
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">Instance size</label>
            <select disabled={!editable} className={`${inputCls} w-full border px-2`} value={form.instancePlan} onChange={(e) => set("instancePlan", e.target.value)}>
              <option value="free">Free — 0.1 CPU / 256 MB</option><option value="starter">Starter — 0.5 CPU / 512 MB</option><option value="standard">Standard — 1 CPU / 2 GB</option><option value="pro">Pro — 2 CPU / 4 GB</option>
            </select></div>
          {field("Instances (horizontal scale)", "instanceCount", { type: "number", min: 1 })}
        </>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={form.autoDeploy} onChange={(e) => set("autoDeploy", e.target.checked)} /> Auto-deploy on push to the production branch</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={form.previewDeployments} onChange={(e) => set("previewDeployments", e.target.checked)} /> Preview deployments for other branches</label>
        <div className="md:col-span-2 flex items-center gap-4">
          <Button disabled={!editable || saving} onClick={save} className="h-9 bg-white text-black hover:bg-white/90 text-xs">{saving ? "Saving…" : "Save changes"}</Button>
          {msg && <span className="text-sm text-zinc-300">{msg}</span>}
        </div>
      </div>

      {(role === "admin" || role === "owner") && (
        <div className="rounded-[16px] border border-red-500/20 bg-red-500/[0.03] p-6 flex items-center justify-between gap-6">
          <div><h3 className="font-medium text-red-300">Delete project</h3><p className="text-sm text-muted-foreground mt-1">Stops all instances and permanently removes deployments, domains and environment variables.</p></div>
          <Button variant="destructive" className="h-9 text-xs" onClick={async () => { if (!confirm(`Delete ${project.name}? This cannot be undone.`)) return; try { await api(`/api/v1/projects/${project.id}`, { method: "DELETE" }); router.push("/dashboard/projects"); router.refresh(); } catch (e) { setMsg((e as Error).message); } }}>Delete</Button>
        </div>
      )}
    </div>
  );
}
