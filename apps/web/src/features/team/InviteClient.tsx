"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, MailX, ShieldAlert, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/app/page";
import { ThemeToggle } from "@/components/app/theme";

interface Invite {
  state: "valid" | "expired" | "revoked" | "accepted" | "not_found";
  orgId?: string;
  orgName?: string;
  role?: string;
  invitedEmail?: string;
  inviterName?: string;
  emailMatches?: boolean;
}

const ROLE_TEXT: Record<string, string> = {
  viewer: "view projects, deployments and logs",
  member: "deploy projects and manage environment variables",
  admin: "manage domains, members and rollbacks",
  owner: "fully control the team",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden />
      <header className="relative flex items-center justify-between px-6 py-5">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-24">{children}</main>
    </div>
  );
}

function Notice({ icon: Icon, tone, title, children }: { icon: React.ComponentType<{ className?: string }>; tone: "ok" | "warn" | "bad"; title: string; children: React.ReactNode }) {
  const color = tone === "ok" ? "bg-success/12 text-success" : tone === "warn" ? "bg-warning/12 text-warning" : "bg-destructive/12 text-destructive";
  return (
    <div className="animate-fade-up rounded-2xl border bg-card p-7 text-center shadow-md">
      <span className={`mx-auto flex size-12 items-center justify-center rounded-full ${color}`}>
        <Icon className="size-6" />
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

export function InviteClient({ token, invite, viewerEmail }: { token: string; invite: Invite; viewerEmail: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ orgId: string }>("/api/v1/invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
      document.cookie = `orb_org=${res.orgId}; path=/; max-age=31536000; samesite=lax`;
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (invite.state === "not_found") {
    return (
      <Shell>
        <Notice icon={MailX} tone="bad" title="Invitation not found">
          This link is not valid. Ask the person who invited you to send a new one.
        </Notice>
        <Button asChild variant="outline" className="mt-4"><Link href="/dashboard">Go to dashboard</Link></Button>
      </Shell>
    );
  }
  if (invite.state === "expired" || invite.state === "revoked") {
    return (
      <Shell>
        <Notice icon={Clock} tone="warn" title={invite.state === "expired" ? "This invitation expired" : "This invitation was withdrawn"}>
          Ask an admin of <b className="font-medium text-foreground">{invite.orgName}</b> to send you a new invitation.
        </Notice>
        <Button asChild variant="outline" className="mt-4"><Link href="/dashboard">Go to dashboard</Link></Button>
      </Shell>
    );
  }
  if (invite.state === "accepted") {
    return (
      <Shell>
        <Notice icon={CheckCircle2} tone="ok" title="Already accepted">
          This invitation to <b className="font-medium text-foreground">{invite.orgName}</b> was already used.
        </Notice>
        <Button asChild className="mt-4"><Link href="/dashboard">Open dashboard</Link></Button>
      </Shell>
    );
  }

  if (!invite.emailMatches) {
    return (
      <Shell>
        <Notice icon={ShieldAlert} tone="warn" title="Wrong account">
          This invitation was sent to <b className="font-medium text-foreground">{invite.invitedEmail}</b>, but you are signed in as <b className="font-medium text-foreground">{viewerEmail}</b>.
          Sign in with the GitHub account that uses the invited address, or ask for a new invitation to your own.
        </Notice>
        <Button
          variant="outline"
          className="mt-4"
          onClick={async () => {
            await signOut();
            router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
          }}
        >
          Sign out and switch account
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="animate-fade-up rounded-2xl border bg-card p-7 shadow-md">
        <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Users className="size-6" />
        </span>
        <p className="mt-5 text-sm text-muted-foreground">{invite.inviterName} invited you to join</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{invite.orgName}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          As <b className="font-medium capitalize text-foreground">{invite.role}</b> you will be able to {ROLE_TEXT[invite.role ?? "member"] ?? "collaborate"}.
        </p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>}
        <div className="mt-6 flex gap-2">
          <Button size="lg" className="flex-1" onClick={accept} loading={busy}>Accept invitation</Button>
          <Button size="lg" variant="outline" asChild><Link href="/dashboard">Not now</Link></Button>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Signed in as {viewerEmail}</p>
      </div>
    </Shell>
  );
}
