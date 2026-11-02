"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { GithubIcon, Logo } from "@/components/app/page";
import { ThemeToggle } from "@/components/app/theme";

const POINTS = [
  "Deploy static sites, web services, workers and cron jobs",
  "Automatic HTTPS and custom domains",
  "Zero-downtime releases with one-click rollbacks",
  "Teams, roles and a full audit log",
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      // `?next=/invite/…` brings people back to where they were headed (open redirects are not possible: local paths only).
      const next = new URLSearchParams(window.location.search).get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
      await signIn.social({ provider: "github", callbackURL: target });
    } catch {
      setError("We couldn't reach GitHub. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative flex flex-col px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Orb</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to deploy and manage your projects.</p>

          <Button size="lg" className="mt-8 w-full" onClick={login} loading={loading}>
            {!loading && <GithubIcon className="size-5" />} Continue with GitHub
          </Button>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            By continuing you agree to the{" "}
            <Link href="#" className="underline underline-offset-2 hover:text-foreground">Terms of Service</Link> and{" "}
            <Link href="#" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>. Orb asks for access to your repositories only to list, build and deploy them.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">← Back to home</Link>
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l bg-card lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight">Everything between <span className="text-accent">git push</span> and production.</h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                  <Check className="size-3" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
