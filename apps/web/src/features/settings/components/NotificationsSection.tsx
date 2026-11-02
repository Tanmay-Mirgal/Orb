"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { CATEGORY_INFO, NOTIFICATION_CATEGORIES, emailEnabled, type NotificationCategory, type NotificationPrefs } from "shared";
import { api, errorMessage } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

/** Which events are e-mailed. Everything also lands in the in-app inbox (the bell); billing and security e-mails are always sent. */
export function NotificationsSection({ email }: { email?: string }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    api<{ preferences: NotificationPrefs }>("/api/v1/me/notifications")
      .then((d) => setPrefs(d.preferences))
      .catch(() => setPrefs({}));
  }, []);

  const toggle = async (category: NotificationCategory, value: boolean) => {
    const previous = prefs ?? {};
    const next: NotificationPrefs = { ...previous, [category]: { email: value } };
    setPrefs(next);
    try {
      await api("/api/v1/me/notifications", { method: "PUT", body: JSON.stringify(next) });
    } catch (e) {
      setPrefs(previous);
      toast.error("Couldn't save", errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-mail notifications</CardTitle>
        <CardDescription>
          Sent to <span className="font-medium text-foreground">{email ?? "your GitHub e-mail"}</span>. Every event also appears under the bell in the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {prefs === null
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="m-5 h-10" />)
          : NOTIFICATION_CATEGORIES.map((id) => {
              const info = CATEGORY_INFO[id];
              return (
                <div key={id} className="flex items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {info.label}
                      {info.mandatory && (
                        <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                          <Lock className="size-2.5" /> Always on
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{info.description}</p>
                  </div>
                  <Switch label={`E-mail me about ${info.label}`} checked={emailEnabled(id, prefs)} disabled={info.mandatory} onCheckedChange={(v) => void toggle(id, v)} />
                </div>
              );
            })}
      </CardContent>
    </Card>
  );
}
