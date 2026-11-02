"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page";

const ROLE_HELP: Record<string, string> = {
  viewer: "Read-only access",
  member: "Deploy and manage environment variables",
  admin: "Plus domains, rollbacks, members and billing",
  owner: "Full control, including deleting the team",
};

export function TeamClient({ org, role, currentUserId }: { org: { id: string; name: string; plan: string; isPersonal: boolean }; role: string; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [members, setMembers] = useState<any[] | null>(null);
  const [logs, setLogs] = useState<any[] | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [teamName, setTeamName] = useState("");
  const [removing, setRemoving] = useState<any | null>(null);
  const isAdmin = role === "admin" || role === "owner";

  const load = useCallback(async () => {
    setMembers((await api(`/api/v1/orgs/${org.id}/members`)).members);
    if (isAdmin) setLogs((await api(`/api/v1/orgs/${org.id}/audit-logs?limit=25`)).logs);
  }, [org.id, isAdmin]);
  useEffect(() => {
    load().catch(() => setMembers([]));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error("Action failed", errorMessage(e));
    }
  };

  return (
    <div className="animate-fade-up max-w-4xl space-y-8">
      <PageHeader
        title={org.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="accent" className="capitalize">{org.plan} plan</Badge>
            <span>You are {role === "admin" ? "an" : "a"} <b className="font-medium text-foreground">{role}</b>.</span>
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{org.isPersonal ? "This is your personal team. Create a shared team below to collaborate." : "People who can access this team's projects."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && !org.isPersonal && (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => { await api(`/api/v1/orgs/${org.id}/members`, { method: "POST", body: JSON.stringify({ email, role: newRole }) }); setEmail(""); }, "Member added");
              }}
            >
              <Input type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
              <Select className="sm:w-36" value={newRole} onChange={(e) => setNewRole(e.target.value)} aria-label="Role">
                <option value="viewer">Viewer</option>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
              <Button type="submit" disabled={!email}>
                <UserPlus /> Add
              </Button>
            </form>
          )}
          {isAdmin && !org.isPersonal && <p className="text-xs text-muted-foreground">They need to have signed in to Orb once. {ROLE_HELP[newRole]}.</p>}

          <div className="overflow-hidden rounded-lg border">
            {members === null ? (
              <div className="space-y-px">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-none" />)}</div>
            ) : (
              <ul className="divide-y">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-3 p-3.5">
                    <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{m.name?.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.name} {m.userId === currentUserId && <span className="text-xs font-normal text-muted-foreground">(you)</span>}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {isAdmin && m.userId !== currentUserId ? (
                      <Select className="w-28" value={m.role} aria-label={`Role of ${m.name}`} onChange={(e) => run(() => api(`/api/v1/orgs/${org.id}/members/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }), "Role updated")}>
                        {["viewer", "member", "admin", "owner"].map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    ) : (
                      <Badge variant="outline">{m.role}</Badge>
                    )}
                    {!org.isPersonal && (isAdmin || m.userId === currentUserId) && (
                      <Button size="icon-sm" variant="ghost" aria-label={m.userId === currentUserId ? "Leave team" : `Remove ${m.name}`} onClick={() => setRemoving(m)}>
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a team</CardTitle>
          <CardDescription>Teams share projects, domains and billing. You become the owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await api("/api/v1/orgs", { method: "POST", body: JSON.stringify({ name: teamName }) });
                document.cookie = `orb_org=${data.organization.id}; path=/; max-age=31536000; samesite=lax`;
                setTeamName("");
                router.push("/dashboard/team");
                router.refresh();
              }, "Team created");
            }}
          >
            <Input placeholder="Acme Inc." value={teamName} onChange={(e) => setTeamName(e.target.value)} aria-label="Team name" />
            <Button type="submit" disabled={teamName.trim().length < 2}>
              <Plus /> Create team
            </Button>
          </form>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Who did what, most recent first.</CardDescription>
          </CardHeader>
          <CardContent>
            {logs === null ? (
              <Skeleton className="h-24" />
            ) : logs.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No activity yet" />
            ) : (
              <ul className="divide-y rounded-lg border">
                {logs.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{l.action}</code>
                      <span className="truncate text-muted-foreground">{l.actorType}{l.targetId ? ` · ${String(l.targetId).slice(0, 24)}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing?.userId === currentUserId ? "Leave this team?" : `Remove ${removing?.name}?`}
        description={removing?.userId === currentUserId ? "You will lose access to its projects." : "They will immediately lose access to this team's projects."}
        confirmLabel={removing?.userId === currentUserId ? "Leave team" : "Remove member"}
        destructive
        onConfirm={() =>
          run(async () => {
            await api(`/api/v1/orgs/${org.id}/members/${removing.userId}`, { method: "DELETE" });
            if (removing.userId === currentUserId) {
              document.cookie = "orb_org=; path=/; max-age=0";
              router.push("/dashboard");
              router.refresh();
            }
          }, "Done")
        }
      />
    </div>
  );
}
