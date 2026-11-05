"use client";

import { useEffect, useState } from "react";
import { Activity, Plug, Trash2, Webhook } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

interface Hook {
  id: string;
  url: string;
  status: string;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  lastResponseCode: number | null;
}

interface Grant {
  id: string;
  clientId: string;
  org: { id: string; name: string };
  scopes: string[];
  connectedBy: { id: string; name: string; email: string };
  createdAt: string;
  lastUsedAt: string | null;
  canRevoke: boolean;
  webhooks: Hook[];
}

interface ActivityRow {
  id: string;
  action: string;
  connectorAction: string | null;
  target: string | null;
  org: string | null;
  createdAt: string;
}

const REASONS: Record<string, string> = {
  endpoint_gone: "the endpoint answered 410 Gone",
  too_many_failures: "50 deliveries in a row failed",
  failing_for_3_days: "deliveries kept failing for 3 days",
  unsafe_url: "the address now resolves to a private network",
  manual: "turned off by the app",
};

const shortScope = (scope: string) => scope.replace(/^orb:/, "");

function HookRow({ hook }: { hook: Hook }) {
  const disabled = hook.status !== "active";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
      <Webhook className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={hook.url}>{hook.url}</span>
      <Badge variant={disabled ? "danger" : "success"} dot>{disabled ? "Disabled" : "Active"}</Badge>
      <span className="basis-full pl-6 text-xs text-muted-foreground sm:basis-auto sm:pl-0">
        {disabled
          ? `Stopped because ${REASONS[hook.disabledReason ?? ""] ?? hook.disabledReason ?? "of repeated failures"}`
          : hook.lastDeliveryAt
            ? `Last delivery ${hook.lastDeliveryStatus ?? "sent"}${hook.lastResponseCode ? ` (${hook.lastResponseCode})` : ""} ${timeAgo(hook.lastDeliveryAt)}`
            : "No deliveries yet"}
        {!disabled && hook.consecutiveFailures > 0 ? ` · ${hook.consecutiveFailures} failed in a row` : ""}
      </span>
    </li>
  );
}

/** Apps connected through the ecosystem connector: what they can access, which webhooks they registered, what they did. */
export function ConnectedAppsSection({ hubName }: { hubName: string }) {
  const toast = useToast();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ grants: Grant[]; activity: ActivityRow[] }>("/api/v1/connector/grants")
      .then((data) => {
        if (!alive) return;
        setGrants(data.grants);
        setActivity(data.activity);
      })
      .catch(() => alive && setGrants([]));
    return () => {
      alive = false;
    };
  }, [reload]);

  const revoke = async (grant: Grant) => {
    try {
      await api(`/api/v1/connector/grants/${grant.id}`, { method: "DELETE" });
      toast.success("Disconnected", `${hubName} can no longer access ${grant.org.name}.`);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error("Couldn't disconnect", errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Connected apps</CardTitle>
          <CardDescription>
            Apps you allowed to work with a team of yours. Each one acts as you, inside one team, and never with more access than your role there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {grants === null ? (
            <Skeleton className="h-24 w-full" />
          ) : grants.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No connected apps"
              description={`When you connect an app like ${hubName} from its own site, it appears here. You choose which team it can reach, and you can disconnect it at any time.`}
              className="py-8"
            />
          ) : (
            <ul className="space-y-4">
              {grants.map((grant) => (
                <li key={grant.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {hubName}
                        <Badge variant="accent">{grant.org.name}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Connected by {grant.connectedBy.name || grant.connectedBy.email} {timeAgo(grant.createdAt)} ·{" "}
                        {grant.lastUsedAt ? `used ${timeAgo(grant.lastUsedAt)}` : "not used yet"}
                      </p>
                    </div>
                    {grant.canRevoke && (
                      <Button size="sm" variant="outline" onClick={() => setRevoking(grant)}>
                        <Trash2 /> Revoke
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Permissions">
                    {grant.scopes.map((scope) => (
                      <Badge key={scope} variant="neutral" className="font-mono">{shortScope(scope)}</Badge>
                    ))}
                  </div>

                  <div className="mt-3 border-t pt-2">
                    <p className="text-xs font-medium text-muted-foreground">Webhook endpoints</p>
                    {grant.webhooks.length === 0 ? (
                      <p className="py-2 text-[13px] text-muted-foreground">None registered.</p>
                    ) : (
                      <ul className="divide-y">{grant.webhooks.map((hook) => <HookRow key={hook.id} hook={hook} />)}</ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {grants && grants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="size-4 text-muted-foreground" /> Recent activity</CardTitle>
            <CardDescription>The last 20 things connected apps did. Payloads are never recorded here.</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {activity.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 py-2.5 text-[13px]">
                    <span className="font-mono text-xs">{row.connectorAction ?? row.action}</span>
                    {row.target && <span className="text-xs text-muted-foreground">{row.target}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">{row.org ? `${row.org} · ` : ""}{timeAgo(row.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => (revoking ? revoke(revoking) : undefined)}
        title={`Disconnect ${hubName}?`}
        description={`${hubName} will lose access to ${revoking?.org.name ?? "this team"} immediately and its webhook endpoints will be removed. Nothing in your projects is deleted.`}
        confirmLabel="Disconnect"
        destructive
      />
    </div>
  );
}
