"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Laptop, LogOut, Moon, Palette, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page";
import { useTheme, type ThemeChoice } from "@/components/app/theme";
import { TokensSection } from "./TokensSection";

type Tab = "profile" | "tokens" | "appearance";
const TABS: TabItem<Tab>[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "tokens", label: "API tokens", icon: KeyRound },
  { id: "appearance", label: "Appearance", icon: Palette },
];

export function SettingsClient() {
  const { data: session } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("profile");
  const user = session?.user;

  return (
    <div className="animate-fade-up max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Your account, API access and preferences." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "profile" && (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Synced from your GitHub account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4">
              {user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="size-16 rounded-full border object-cover" />
              ) : (
                <span className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-xl font-semibold text-accent">{user?.name?.charAt(0).toUpperCase() ?? "U"}</span>
              )}
              <p className="text-[13px] text-muted-foreground">Change your name or avatar on GitHub and sign in again to refresh them.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={user?.name ?? ""} disabled readOnly /></Field>
              <Field label="Email"><Input value={user?.email ?? ""} disabled readOnly /></Field>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={async () => { await signOut(); router.push("/login"); }}>
              <LogOut /> Sign out
            </Button>
          </CardFooter>
        </Card>
      )}

      {tab === "tokens" && <TokensSection />}

      {tab === "appearance" && (
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>Choose how Orb looks on this device.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "System", Laptop],
              ] as Array<[ThemeChoice, string, React.ComponentType<{ className?: string }>]>
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={cn("flex items-center gap-3 rounded-lg border p-4 text-left transition-all hover:border-foreground/30", theme === id && "border-accent ring-2 ring-accent/30")}
              >
                <Icon className="size-5 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
