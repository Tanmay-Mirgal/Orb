"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Personal API tokens for the REST API / CI (`Authorization: Bearer orb_...`). Shown once at creation. */
export function TokensSection() {
  const toast = useToast();
  const [tokens, setTokens] = useState<any[] | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setTokens((await api("/api/v1/tokens")).tokens), []);
  useEffect(() => {
    load().catch(() => setTokens([]));
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const data = await api("/api/v1/tokens", { method: "POST", body: JSON.stringify({ name, expiresInDays: days === "never" ? null : Number(days) }) });
      setCreated(data.token);
      setName("");
      await load();
    } catch (e) {
      toast.error("Couldn't create token", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          Trigger deployments and manage projects from CI or scripts: <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Authorization: Bearer orb_…</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {created && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3.5">
            <p className="mb-2 text-[13px] font-medium text-success">Copy your token now — it will not be shown again.</p>
            <div className="flex items-center gap-2 rounded-md border bg-card p-2 font-mono text-xs">
              <span className="min-w-0 flex-1 break-all">{created}</span>
              <CopyButton value={created} label="Copy token" />
            </div>
          </div>
        )}

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Input placeholder="Token name, e.g. GitHub Actions" value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" />
          <Select className="sm:w-36" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Expiry">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="never">No expiry</option>
          </Select>
          <Button type="submit" loading={busy} disabled={name.trim().length < 2}>
            Create token
          </Button>
        </form>

        {tokens?.length === 0 ? (
          <EmptyState icon={KeyRound} title="No active tokens" className="py-8" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {tokens?.map((t) => (
              <li key={t.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t.name} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{t.prefix}…</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.lastUsedAt ? `Used ${timeAgo(t.lastUsedAt)}` : "Never used"}
                    {t.expiresAt ? ` · expires ${new Date(t.expiresAt).toLocaleDateString()}` : " · no expiry"}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Revoke ${t.name}`} onClick={async () => { await api(`/api/v1/tokens/${t.id}`, { method: "DELETE" }); toast.success("Token revoked"); void load(); }}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
