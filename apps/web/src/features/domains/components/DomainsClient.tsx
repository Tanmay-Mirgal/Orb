"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Globe, Plus, RefreshCcw, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { CopyButton, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page";

interface DomainRow {
  domain: string;
  projectId: string;
  projectName: string;
  projectSlug: string | null;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  redirectTo: string | null;
  instructions: Array<{ type: string; host: string; value: string; purpose: string }>;
}

const TONE: Record<string, { label: string; variant: "success" | "info" | "warning" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  verified: { label: "Waiting for DNS", variant: "info" },
  pending: { label: "Verify ownership", variant: "warning" },
  error: { label: "Error", variant: "danger" },
};

export function DomainsClient() {
  const toast = useToast();
  const [rows, setRows] = useState<DomainRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<DomainRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => setRows((await api<{ domains: DomainRow[] }>("/api/v1/domains")).domains), []);
  useEffect(() => {
    load().catch(() => setRows([]));
  }, [load]);

  const verify = async (row: DomainRow) => {
    setBusy(row.domain);
    try {
      const result = await api(`/api/v1/projects/${row.projectId}/domains/${encodeURIComponent(row.domain)}/verify`, { method: "POST", body: "{}" });
      toast[result.domain.status === "active" ? "success" : "info"](
        result.domain.status === "active" ? `${row.domain} is live` : "Not ready yet",
        result.domain.status === "active" ? "HTTPS is being issued automatically." : (result.domain.lastError ?? "DNS records were not found yet."),
      );
      await load();
    } catch (e) {
      toast.error("Verification failed", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => (rows ?? []).filter((r) => r.domain.includes(query.toLowerCase()) || r.projectName.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const counts = useMemo(() => ({ active: (rows ?? []).filter((r) => r.status === "active").length, attention: (rows ?? []).filter((r) => r.status !== "active").length }), [rows]);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title="Domains"
        description="Custom domains attached to your projects. Add a domain from a project's Domains tab."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/projects">
              <Plus /> Add via project
            </Link>
          </Button>
        }
      />

      {rows === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Globe} title="No custom domains yet" description="Open a project, go to the Domains tab and add a domain you own. We'll guide you through DNS and issue HTTPS automatically." action={<Button asChild><Link href="/dashboard/projects">Go to projects</Link></Button>} />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search domains…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search domains" />
            </div>
            <p className="text-[13px] text-muted-foreground">
              {counts.active} active · {counts.attention} need attention
            </p>
          </div>

          <Card className="overflow-hidden">
            <ul className="divide-y">
              {filtered.map((r) => {
                const tone = TONE[r.status] ?? TONE.pending!;
                return (
                  <li key={r.domain} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-semibold hover:text-accent">
                          {r.domain} <ExternalLink className="size-3 text-muted-foreground" />
                        </a>
                        <Badge variant={tone.variant} dot>{tone.label}</Badge>
                        {r.redirectTo && <span className="text-xs text-muted-foreground">→ {r.redirectTo}</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Project{" "}
                        <Link href={`/dashboard/projects/${r.projectSlug ?? ""}`} className="font-medium text-foreground hover:underline">
                          {r.projectName}
                        </Link>
                        {r.lastCheckedAt && <> · checked {timeAgo(r.lastCheckedAt)}</>}
                      </p>
                      {r.status !== "active" && r.lastError && <p className="mt-1 text-xs text-warning">{r.lastError}</p>}
                    </div>
                    {r.status !== "active" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDetail(r)}>
                          DNS records
                        </Button>
                        <Button size="sm" loading={busy === r.domain} onClick={() => verify(r)}>
                          {busy !== r.domain && <RefreshCcw />} Verify
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}

      <Dialog open={detail !== null} onClose={() => setDetail(null)} title={`DNS records for ${detail?.domain}`} description="Create these records at your DNS provider, then press Verify." className="sm:max-w-2xl">
        <div className="space-y-3">
          {detail?.instructions.map((r, i) => (
            <div key={i} className="rounded-lg border p-3 text-[13px]">
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="outline">{r.type}</Badge>
                <span className="text-xs text-muted-foreground">{r.purpose === "ownership" ? "Proves you own the domain" : "Sends traffic to Orb"}</span>
              </div>
              <dl className="space-y-1.5 font-mono text-xs">
                <div className="flex items-center gap-2"><dt className="w-12 text-muted-foreground">Name</dt><dd className="break-all">{r.host}</dd><CopyButton value={r.host} /></div>
                <div className="flex items-center gap-2"><dt className="w-12 text-muted-foreground">Value</dt><dd className="break-all">{r.value}</dd><CopyButton value={r.value} /></div>
              </dl>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
