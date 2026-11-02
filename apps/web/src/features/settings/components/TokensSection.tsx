"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Personal API tokens for the REST API / CI (`Authorization: Bearer orb_...`). Shown once at creation. */
export function TokensSection() {
  const [tokens, setTokens] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setTokens((await api("/api/v1/tokens")).tokens), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const create = async () => {
    setError(null);
    try {
      const data = await api("/api/v1/tokens", { method: "POST", body: JSON.stringify({ name, expiresInDays: days === "never" ? null : Number(days) }) });
      setCreated(data.token);
      setName("");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">API tokens</h2>
      <p className="text-sm text-muted-foreground mb-6">Use tokens to trigger deployments and manage projects from CI or scripts: <code className="font-mono text-xs">curl -H "Authorization: Bearer orb_…" /api/v1/projects</code></p>
      <div className="rounded-[24px] border border-border/40 bg-card p-6 flex flex-col gap-5">
        {created && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm">
            <p className="text-green-300 mb-2">Copy your token now. It will not be shown again.</p>
            <div className="flex items-center gap-3 font-mono text-xs break-all">{created}<button onClick={() => navigator.clipboard?.writeText(created)}><Copy className="h-4 w-4" /></button></div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Input className="h-9 max-w-xs bg-[#050505] border-white/10" placeholder="Token name (e.g. GitHub Actions)" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="h-9 rounded-md bg-[#050505] border border-white/10 px-2 text-sm" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">No expiry</option>
          </select>
          <Button disabled={name.trim().length < 2} onClick={create} className="h-9 bg-white text-black hover:bg-white/90 text-xs">Create token</Button>
        </div>
        {error && <div className="text-sm text-red-300">{error}</div>}
        <div className="divide-y divide-white/5">
          {tokens.length === 0 && <div className="py-3 text-sm text-muted-foreground">No active tokens.</div>}
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-3 text-sm">
              <div><span className="font-medium">{t.name}</span> <span className="font-mono text-xs text-muted-foreground ml-2">{t.prefix}…</span>
                <div className="text-xs text-muted-foreground">{t.lastUsedAt ? `Used ${formatDistanceToNow(new Date(t.lastUsedAt))} ago` : "Never used"}{t.expiresAt ? ` · expires ${formatDistanceToNow(new Date(t.expiresAt), { addSuffix: true })}` : ""}</div></div>
              <button className="text-muted-foreground hover:text-red-400" onClick={async () => { await api(`/api/v1/tokens/${t.id}`, { method: "DELETE" }); load(); }}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
