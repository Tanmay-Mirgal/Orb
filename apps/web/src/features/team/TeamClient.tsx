"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const card = "rounded-[16px] border border-white/10 bg-white/[0.02]";

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function TeamClient({ org, role, currentUserId }: { org: { id: string; name: string; plan: string; isPersonal: boolean }; role: string; currentUserId: string }) {
  const router = useRouter();
  const [members, setMembers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [teamName, setTeamName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = role === "admin" || role === "owner";

  const load = useCallback(async () => {
    setMembers((await api(`/api/v1/orgs/${org.id}/members`)).members);
    if (isAdmin) setLogs((await api(`/api/v1/orgs/${org.id}/audit-logs?limit=30`)).logs);
  }, [org.id, isAdmin]);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div className="flex flex-col gap-8 pb-20 max-w-4xl">
      <div className="border-b border-border/40 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">Plan: <span className="capitalize text-white">{org.plan}</span> · Your role: <span className="text-white">{role}</span></p>
      </div>
      {msg && <div className="text-sm text-red-300">{msg}</div>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Members</h2>
        {isAdmin && !org.isPersonal && (
          <form className={`${card} p-4 flex flex-wrap gap-3`} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/api/v1/orgs/${org.id}/members`, { method: "POST", body: JSON.stringify({ email, role: newRole }) }); setEmail(""); }); }}>
            <Input className="h-9 max-w-xs bg-[#050505] border-white/10" type="email" placeholder="teammate@example.com (must have signed in once)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="h-9 rounded-md bg-[#050505] border border-white/10 px-2 text-sm" value={newRole} onChange={(e) => setNewRole(e.target.value)}><option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option></select>
            <Button type="submit" disabled={!email} className="h-9 bg-white text-black hover:bg-white/90 text-xs">Add member</Button>
          </form>
        )}
        {org.isPersonal && <p className="text-sm text-muted-foreground">This is your personal team. Create a shared team below to collaborate.</p>}
        <div className={`${card} divide-y divide-white/5`}>
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between px-5 py-3.5">
              <div><div className="text-sm font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.email}</div></div>
              <div className="flex items-center gap-3">
                {isAdmin && m.userId !== currentUserId ? (
                  <select className="h-8 rounded-md bg-[#050505] border border-white/10 px-2 text-xs" value={m.role} onChange={(e) => run(() => api(`/api/v1/orgs/${org.id}/members/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }))}>
                    {["viewer", "member", "admin", "owner"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : <span className="text-xs text-muted-foreground">{m.role}</span>}
                {(isAdmin || m.userId === currentUserId) && !org.isPersonal && (
                  <button className="text-muted-foreground hover:text-red-400" title={m.userId === currentUserId ? "Leave team" : "Remove"} onClick={() => confirm("Are you sure?") && run(async () => { await api(`/api/v1/orgs/${org.id}/members/${m.userId}`, { method: "DELETE" }); if (m.userId === currentUserId) { document.cookie = "orb_org=; path=/; max-age=0"; router.push("/dashboard"); router.refresh(); } })}><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Create a team</h2>
        <form className={`${card} p-4 flex gap-3`} onSubmit={(e) => { e.preventDefault(); run(async () => { const data = await api("/api/v1/orgs", { method: "POST", body: JSON.stringify({ name: teamName }) }); document.cookie = `orb_org=${data.organization.id}; path=/; max-age=31536000; samesite=lax`; router.push("/dashboard/team"); router.refresh(); }); }}>
          <Input className="h-9 max-w-xs bg-[#050505] border-white/10" placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          <Button type="submit" disabled={teamName.trim().length < 2} className="h-9 bg-white text-black hover:bg-white/90 text-xs">Create team</Button>
        </form>
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Audit log</h2>
          <div className={`${card} divide-y divide-white/5`}>
            {logs.length === 0 && <div className="p-5 text-sm text-muted-foreground">No activity yet.</div>}
            {logs.map((l) => (
              <div key={l.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span><span className="font-mono text-xs bg-white/5 rounded px-1.5 py-0.5 mr-2">{l.action}</span><span className="text-muted-foreground">{l.actorType}{l.targetId ? ` · ${String(l.targetId).slice(0, 36)}` : ""}</span></span>
                <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(l.createdAt))} ago</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
