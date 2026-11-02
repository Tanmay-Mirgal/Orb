"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Bell, Check, Cog, CreditCard, Globe, KeyRound, Lock, Mail, Menu, Moon, Play, RotateCcw, Rocket, Server, ShieldCheck, Sparkles, Timer, UserPlus, Users, X, Zap,
} from "lucide-react";
import { ORG_PLANS } from "shared";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/app/page";
import { ThemeToggle } from "@/components/app/theme";

const NAV = [
  { label: "Tour", href: "#tour" },
  { label: "Features", href: "#features" },
  { label: "Teams", href: "#teams" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

/** Scroll-reveal: content is visible without JS; once mounted, sections below the fold fade up as they enter. */
function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.dataset.reveal = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.shown = "true";
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => {
      io.disconnect();
      delete root.dataset.reveal;
    };
  }, []);
}

export function LandingClient() {
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  useReveal();
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <style>{`
        html[data-reveal="armed"] [data-reveal]:not([data-shown]) { opacity: 0; transform: translateY(18px); }
        [data-reveal] { transition: opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1); transition-delay: var(--d, 0ms); }
        @keyframes orb-pulse { 0%,100% { opacity:.55 } 50% { opacity:.9 } }
        @keyframes caret { 0%,49% { opacity:1 } 50%,100% { opacity:0 } }
        .text-shine { background: linear-gradient(100deg, var(--accent) 10%, color-mix(in oklab, var(--accent) 55%, #c084fc) 55%, var(--accent) 90%); -webkit-background-clip: text; background-clip: text; color: transparent; }
      `}</style>
      <Navbar signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} />
        <Tour />
        <Stack />
        <Features />
        <HowItWorks />
        <Teams />
        <Pricing signedIn={signedIn} />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>
      <Footer />
    </div>
  );
}

function Navbar({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Button asChild>
              <Link href="/dashboard">
                Dashboard <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild className="hidden sm:inline-flex">
                <Link href="/login">
                  Start for free <ArrowRight />
                </Link>
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={open}>
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t bg-background px-5 py-3 md:hidden">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2.5 text-sm">
              {n.label}
            </a>
          ))}
          {!signedIn && (
            <Button asChild className="mt-2 w-full">
              <Link href="/login">Start for free</Link>
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

/* ─────────────────────────────── Hero ─────────────────────────────── */

const LOG: Array<[string, string]> = [
  ["", "$ git push origin main"],
  ["", "[git]     Cloning acme/storefront@main"],
  ["", "[detect]  Next.js (node) → web service"],
  ["", "[docker]  Image built · 38 s"],
  ["ok", "✓ Instance 4f9a21c0 healthy"],
  ["ok", "✓ Live: traffic switched — zero downtime"],
];

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative isolate">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px]" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-[-140px] -z-10 size-[760px] -translate-x-1/2 rounded-full bg-accent/25 blur-[120px]" style={{ animation: "orb-pulse 7s ease-in-out infinite" }} aria-hidden />
      <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-16 text-center sm:pt-24">
        <a href="#teams" className="animate-fade-up mx-auto inline-flex items-center gap-2 rounded-full border bg-card/70 px-3.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-card">
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">New</span>
          Teams, invitations, alerts and Razorpay billing
          <ArrowRight className="size-3.5 text-muted-foreground" />
        </a>
        <h1 className="animate-fade-up mx-auto mt-7 max-w-4xl text-balance text-5xl font-semibold leading-[1.04] tracking-tight sm:text-7xl" style={{ animationDelay: "60ms" }}>
          From <span className="text-shine">git push</span> to production, in seconds.
        </h1>
        <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg" style={{ animationDelay: "120ms" }}>
          Orb builds your repository, ships it behind automatic HTTPS and runs static sites, web services, workers and cron jobs — with custom domains, instant rollbacks, teams and alerts built in.
        </p>
        <div className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: "180ms" }}>
          <Button asChild size="lg" className="h-12 px-7 text-base">
            <Link href={signedIn ? "/dashboard" : "/login"}>
              {signedIn ? "Open dashboard" : "Start deploying free"} <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-7 text-base">
            <a href="#tour">
              <Play className="fill-current" /> Watch the 55-second tour
            </a>
          </Button>
        </div>
        <p className="animate-fade-up mt-4 text-xs text-muted-foreground" style={{ animationDelay: "220ms" }}>
          Sign in with GitHub · free Hobby plan · no credit card
        </p>

        <div className="animate-fade-up relative mx-auto mt-16 max-w-3xl text-left" style={{ animationDelay: "280ms" }}>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-lg">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <span className="size-2.5 rounded-full bg-destructive/70" />
              <span className="size-2.5 rounded-full bg-warning/70" />
              <span className="size-2.5 rounded-full bg-success/70" />
              <span className="ml-3 truncate font-mono text-xs text-muted-foreground">orb · deployment 4f9a21c0</span>
              <Badge variant="success" dot className="ml-auto">Ready</Badge>
            </div>
            <div className="space-y-1.5 bg-[#0a0a0c] p-5 font-mono text-[12.5px] leading-6">
              {LOG.map(([tone, line], i) => (
                <p key={i} className={cn("animate-fade-up", tone === "ok" ? "text-emerald-400" : i === 0 ? "text-zinc-100" : "text-zinc-400")} style={{ animationDelay: `${500 + i * 340}ms` }}>
                  {line}
                  {i === LOG.length - 1 && <span className="ml-1 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent" style={{ animation: "caret 1s steps(1) infinite" }} />}
                </p>
              ))}
            </div>
          </div>

          <div className="animate-fade-up absolute -right-4 -top-6 hidden w-64 rounded-xl border bg-card/95 p-3.5 shadow-lg backdrop-blur md:block lg:-right-16" style={{ animationDelay: "1400ms" }}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success"><Rocket className="size-4" /></span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight">storefront is live</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">Update pricing page</p>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Mail className="size-3" /> E-mail sent · in-app alert</p>
              </div>
            </div>
          </div>
          <div className="animate-fade-up absolute -bottom-6 -left-4 hidden items-center gap-2 rounded-full border bg-card/95 px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur md:flex lg:-left-12" style={{ animationDelay: "1800ms" }}>
            <Lock className="size-3.5 text-success" /> shop.acme.dev · HTTPS issued automatically
          </div>
          <div className="animate-fade-up absolute -bottom-10 right-6 hidden items-center gap-2 rounded-full border bg-card/95 px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur md:flex lg:-right-6" style={{ animationDelay: "2200ms" }}>
            <RotateCcw className="size-3.5 text-accent" /> Rolled back · 0 s downtime
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Tour (video) ─────────────────────────────── */

const CHAPTERS: Array<[string, number]> = [
  ["Git deploys", 4],
  ["Project types", 9],
  ["Rollbacks", 14],
  ["Domains", 19],
  ["Secrets & logs", 24],
  ["Teams", 30],
  ["Alerts", 35],
  ["Sleep & wake", 40],
  ["Plans", 45],
];

const TRANSCRIPT = [
  "From git push to production in seconds.",
  "Pick a GitHub repo. Orb detects the framework, builds it and goes live.",
  "Static sites, web services, background workers and cron jobs.",
  "Releases only get traffic when healthy. Roll back in one click.",
  "Bring your own domain. HTTPS is issued and renewed automatically.",
  "Encrypted environment variables. Live logs. Request analytics.",
  "Invite teammates by e-mail: owner, admin, member or viewer.",
  "Alerts in your dashboard and your inbox: deploys, domains, billing.",
  "Free services sleep after 20 minutes and wake on the next request.",
  "Hobby is free. Upgrade with Razorpay: UPI, cards or netbanking.",
  "Orb. Deploy anything. Scale without servers.",
];

function Tour() {
  const ref = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(-1);

  const seek = (t: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = t + 0.05;
    void v.play().catch(() => undefined);
  };
  const onTime = () => {
    const t = ref.current?.currentTime ?? 0;
    let idx = -1;
    CHAPTERS.forEach(([, at], i) => {
      if (t >= at - 0.1) idx = i;
    });
    setActive(idx);
  };

  return (
    <section id="tour" className="relative scroll-mt-20 px-5 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <Badge variant="accent"><Play className="size-3 fill-current" /> 55-second product tour</Badge>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">See every feature, in under a minute</h2>
          <p className="mt-3 text-muted-foreground">Deploys, rollbacks, domains, secrets, teams, alerts and billing — captioned, so it works on mute.</p>
        </div>

        <div className="relative mt-10" data-reveal style={{ ["--d" as string]: "80ms" }}>
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-accent/15 blur-3xl" aria-hidden />
          <div className="overflow-hidden rounded-2xl border bg-black shadow-lg ring-1 ring-white/5">
            <video
              ref={ref}
              className="aspect-video w-full bg-black"
              controls
              playsInline
              preload="none"
              poster="/media/orb-tour-poster.jpg"
              onTimeUpdate={onTime}
              onEnded={() => setActive(-1)}
            >
              <source src="/media/orb-tour.mp4" type="video/mp4" />
              Your browser does not support embedded video. The tour is a 55-second walkthrough of Orb&apos;s features.
            </video>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label="Jump to a chapter">
            {CHAPTERS.map(([label, at], i) => (
              <button
                key={label}
                onClick={() => seek(at)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                  active === i ? "border-accent bg-accent-soft text-accent" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="mr-1.5 font-mono text-[10px] opacity-70">0:{String(at).padStart(2, "0")}</span>
                {label}
              </button>
            ))}
          </div>
          <details className="mx-auto mt-5 max-w-2xl rounded-xl border bg-card/60 px-4 py-3 text-sm">
            <summary className="cursor-pointer select-none text-[13px] font-medium text-muted-foreground">Read the captions as text</summary>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-muted-foreground">
              {TRANSCRIPT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </details>
        </div>
      </div>
    </section>
  );
}

function Stack() {
  const items = ["Next.js", "React", "Vue", "Astro", "Vite", "Node.js", "Python", "Go", "Docker"];
  return (
    <section className="border-y bg-card/40 py-8" aria-label="Supported stacks">
      <div className="mx-auto max-w-6xl px-5">
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">Works with the tools you already use</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm font-medium text-muted-foreground">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Features (bento) ─────────────────────────────── */

function Tile({ icon: Icon, title, text, className, children, delay = 0 }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; className?: string; children?: React.ReactNode; delay?: number }) {
  return (
    <div
      data-reveal
      style={{ ["--d" as string]: `${delay}ms` }}
      className={cn("group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-[box-shadow,border-color] hover:border-foreground/20 hover:shadow-md", className)}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{text}</p>
      {children && <div className="mt-5 flex-1">{children}</div>}
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
      <div className="mx-auto max-w-2xl text-center" data-reveal>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Everything between <span className="text-shine">push</span> and production</h2>
        <p className="mt-4 text-muted-foreground">The workflow of a modern PaaS, on infrastructure that costs less than you would expect.</p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-6">
        <Tile icon={Zap} title="Git-driven deploys" text="Push to deploy. Orb detects the framework, builds in an isolated container and only switches traffic once the new release is healthy." className="md:col-span-4" delay={0}>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            {["Queued", "Building", "Deploying", "Ready"].map((s, i, a) => (
              <span key={s} className="flex items-center gap-2">
                <span className={cn("rounded-full border px-3 py-1.5", i === a.length - 1 ? "border-success/30 bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>{s}</span>
                {i < a.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground/50" />}
              </span>
            ))}
          </div>
        </Tile>
        <Tile icon={RotateCcw} title="Instant rollbacks" text="Every commit is an immutable deployment. Promote any older one in a click — a failed release never replaces the live one." className="md:col-span-2" delay={60}>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-lg border bg-secondary/50 px-3 py-2"><span className="font-mono">e41b0d2</span><Badge variant="success">Live</Badge></div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-muted-foreground"><span className="font-mono">7f3a9c1</span><span>Promote</span></div>
          </div>
        </Tile>

        <Tile icon={Server} title="Services, workers & cron" text="Static sites, web services, background workers and scheduled jobs side by side — from a repo or your own Dockerfile." className="md:col-span-2" delay={0} />
        <Tile icon={Globe} title="Custom domains & HTTPS" text="Point a CNAME at Orb and you are done: ownership is proven by DNS, certificates are issued and renewed for you." className="md:col-span-2" delay={60}>
          <div className="flex items-center gap-2 rounded-lg border bg-secondary/50 px-3 py-2 font-mono text-xs"><Lock className="size-3.5 text-success" /> https://shop.acme.dev</div>
        </Tile>
        <Tile icon={Lock} title="Secrets done right" text="Environment variables are encrypted at rest, scoped per environment and never shown again once saved." className="md:col-span-2" delay={120}>
          <div className="space-y-1.5 font-mono text-xs text-muted-foreground">
            <div className="flex justify-between rounded-md border px-3 py-1.5"><span>DATABASE_URL</span><span>••••••••</span></div>
            <div className="flex justify-between rounded-md border px-3 py-1.5"><span>SESSION_SECRET</span><span>••••••••</span></div>
          </div>
        </Tile>

        <Tile icon={Bell} title="Alerts that find you" text="Deploy finished or failed, a domain went live, a service lost an instance, a plan is ending — in the dashboard bell and in your inbox. Pick what you want e-mailed." className="md:col-span-3" delay={0}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 items-center gap-3 rounded-xl border bg-secondary/40 p-3">
              <span className="relative flex size-9 items-center justify-center rounded-lg bg-card"><Bell className="size-4" /><span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">3</span></span>
              <div className="text-xs"><p className="font-semibold">api failed to deploy</p><p className="text-muted-foreground">Open the build log</p></div>
            </div>
            <div className="flex flex-1 items-center gap-3 rounded-xl border bg-secondary/40 p-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-card"><Mail className="size-4" /></span>
              <div className="text-xs"><p className="font-semibold">storefront deployed</p><p className="text-muted-foreground">View deployment →</p></div>
            </div>
          </div>
        </Tile>
        <Tile icon={BarChart3} title="Logs & analytics" text="Live build and runtime logs, plus requests, bandwidth and latency for every project." className="md:col-span-3" delay={60}>
          <svg viewBox="0 0 300 70" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
            <defs><linearGradient id="spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".3" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 52 C25 48 40 36 66 40 C92 44 104 18 140 22 C176 26 190 46 220 28 C250 10 270 8 300 4 L300 70 L0 70Z" fill="url(#spark)" />
            <path d="M0 52 C25 48 40 36 66 40 C92 44 104 18 140 22 C176 26 190 46 220 28 C250 10 270 8 300 4" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </Tile>

        <Tile icon={Moon} title="Free services sleep, then wake on request" text="Hobby web services stop after 20 idle minutes and start again on the next visit — which is how a free tier stays free." className="md:col-span-2" delay={0} />
        <Tile icon={KeyRound} title="API & tokens" text="Everything in the dashboard is a REST call. Personal access tokens for CI, with an alert whenever one is created." className="md:col-span-2" delay={60} />
        <Tile icon={ShieldCheck} title="Audit log" text="Who deployed, invited, changed a role or paid — every sensitive action is recorded per team." className="md:col-span-2" delay={120} />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, icon: Cog, title: "Connect a repository", text: "Sign in with GitHub and pick a repo. Orb detects the framework and fills in build, start and port settings." },
    { n: 2, icon: Timer, title: "We build & release", text: "Your app is built in an isolated container, started on a healthy node, and only then promoted to production." },
    { n: 3, icon: ShieldCheck, title: "Go live on your domain", text: "Add your domain, create one DNS record and get HTTPS automatically. Push again any time — or roll back." },
  ];
  return (
    <section id="how" className="scroll-mt-20 border-y bg-card/40 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight sm:text-4xl" data-reveal>Live in three steps</h2>
        <ol className="relative mt-14 grid gap-6 md:grid-cols-3">
          <div className="absolute left-[16%] right-[16%] top-9 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" aria-hidden />
          {steps.map((s, i) => (
            <li key={s.n} data-reveal style={{ ["--d" as string]: `${i * 90}ms` }} className="relative rounded-2xl border bg-card p-6 shadow-sm">
              <span className="relative z-10 flex size-12 items-center justify-center rounded-2xl border bg-background text-accent shadow-sm">
                <s.icon className="size-5" />
              </span>
              <span className="absolute right-6 top-6 font-mono text-sm text-muted-foreground/60">0{s.n}</span>
              <h3 className="mt-5 text-base font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Teams ─────────────────────────────── */

const ROLE_ROWS: Array<[string, boolean[]]> = [
  ["See projects, deployments and logs", [true, true, true, true]],
  ["Deploy, edit env vars, create tokens", [false, true, true, true]],
  ["Domains, rollbacks, invite members", [false, false, true, true]],
  ["Billing, delete the team", [false, false, false, true]],
];

function Teams() {
  return (
    <section id="teams" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div data-reveal>
          <Badge variant="accent"><Users className="size-3" /> Teams</Badge>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Build as a team, with the right access</h2>
          <p className="mt-4 text-muted-foreground">Create a team, invite people by e-mail and give each of them exactly the access they need. Projects, domains and billing live with the team, not with one person.</p>
          <ul className="mt-6 space-y-3 text-[14px]">
            {[
              "Invitations land in the inbox with a one-click accept link",
              "Owner, admin, member and viewer roles — enforced on every API call",
              "Deploy, domain and payment alerts reach the right people",
              "Only the owner can spend money or delete the team",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-4" data-reveal style={{ ["--d" as string]: "100ms" }}>
          <div className="rounded-2xl border bg-card p-5 shadow-md">
            <p className="text-sm font-semibold">Invite a teammate</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="flex h-10 flex-1 items-center rounded-lg border bg-secondary/40 px-3 font-mono text-[13px] text-muted-foreground">maya@acme.dev</div>
              <div className="flex h-10 items-center rounded-lg border bg-secondary/40 px-3 text-[13px] sm:w-32">Member ▾</div>
              <div className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground"><UserPlus className="size-4" /> Invite</div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-success"><Check className="size-3.5" /> Invitation sent · expires in 7 days</p>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Can…</th>
                  {["Viewer", "Member", "Admin", "Owner"].map((r) => <th key={r} className="px-2 py-2.5 text-center font-medium">{r}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {ROLE_ROWS.map(([label, allowed]) => (
                  <tr key={label}>
                    <td className="px-4 py-2.5">{label}</td>
                    {allowed.map((ok, i) => (
                      <td key={i} className="px-2 py-2.5 text-center">{ok ? <Check className="mx-auto size-4 text-success" /> : <span className="text-muted-foreground/40">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Pricing ─────────────────────────────── */

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function Pricing({ signedIn }: { signedIn: boolean }) {
  const plans = Object.values(ORG_PLANS);
  const [yearly, setYearly] = useState(false);
  return (
    <section id="pricing" className="scroll-mt-20 border-y bg-card/40 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Free for most. Fair when you grow.</h2>
          <p className="mt-3 text-muted-foreground">Hobby is free forever and is all most people need. Upgrade for teams, always-on services and bigger instances.</p>
          <div role="group" aria-label="Billing period" className="mt-7 inline-flex rounded-full border bg-card p-1 text-[13px] shadow-sm">
            {([false, true] as const).map((y) => (
              <button key={String(y)} onClick={() => setYearly(y)} aria-pressed={yearly === y} className={cn("rounded-full px-4 py-1.5 font-medium transition-colors", yearly === y ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {y ? "Yearly" : "Monthly"}
                {y && <span className={cn("ml-1.5 text-[11px]", yearly ? "opacity-80" : "text-success")}>2 months free</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {plans.map((p, idx) => {
            const popular = p.id === "pro";
            const price = yearly ? p.priceInrYear : p.priceInrMonth;
            const features = [
              `${p.maxProjects} projects`,
              p.maxMembers === 1 ? "1 person" : `${p.maxMembers} team members with roles`,
              `${p.maxContainerProjects} web service / worker / cron projects`,
              p.idleSleepMinutes ? `Services sleep after ${p.idleSleepMinutes} min idle` : "Services always on",
              `${p.maxDomainsPerProject} custom domains per project`,
              `Up to ${p.maxInstancesPerService} instance${p.maxInstancesPerService === 1 ? "" : "s"} per service`,
              p.previewDeployments ? "Preview deployments" : "Production deployments",
              "E-mail + in-app alerts",
            ];
            return (
              <div key={p.id} data-reveal style={{ ["--d" as string]: `${idx * 80}ms` }} className={cn("relative flex flex-col rounded-2xl border bg-card p-7 shadow-sm", popular && "border-accent shadow-md ring-2 ring-accent/20", p.id === "free" && "bg-gradient-to-b from-accent-soft/60 to-card")}>
                {popular && <Badge variant="accent" className="absolute -top-3 left-7" style={{ background: "color-mix(in oklab, var(--accent) 16%, var(--card))" }}>Most popular</Badge>}
                {p.id === "free" && <Badge variant="success" className="absolute -top-3 left-7" style={{ background: "color-mix(in oklab, var(--success) 16%, var(--card))" }}>What most people use</Badge>}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-3 text-5xl font-semibold tracking-tight tabular-nums">
                  {price === 0 ? "₹0" : inr(price)}
                  <span className="text-sm font-normal text-muted-foreground"> {price === 0 ? "forever" : yearly ? "/ year" : "/ month"}</span>
                </p>
                <p className="mt-1 h-4 text-xs text-muted-foreground">{price > 0 && yearly ? `${inr(Math.round(price / 12))} / month, billed yearly` : ""}</p>
                <ul className="mt-6 flex-1 space-y-2.5 text-[13.5px]">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}</li>
                  ))}
                </ul>
                <Button asChild className="mt-8 w-full" variant={popular ? "accent" : "outline"} size="lg">
                  <Link href={signedIn ? (p.id === "free" ? "/dashboard" : "/dashboard/billing") : "/login"}>{p.priceInrMonth === 0 ? "Start free" : `Choose ${p.name}`}</Link>
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted-foreground" data-reveal>
          <CreditCard className="size-3.5" /> Pay with UPI, cards or netbanking via Razorpay. Prepaid — it never renews on its own, and we remind you before it ends.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────── FAQ / CTA / Footer ─────────────────────────────── */

const FAQ = [
  ["What can I deploy?", "Static sites (Vite, React, Astro, Docusaurus, plain HTML), SSR apps (Next.js, Nuxt, Remix), backend services (Node, Python, Go) and anything with a Dockerfile. You can also run background workers and cron jobs."],
  ["Is the Hobby plan really free?", "Yes, forever, with no card. You get 5 projects, custom domains with HTTPS and up to 2 web service / worker / cron projects. Free web services go to sleep after 20 idle minutes and wake on the next request; static sites are always on."],
  ["How do custom domains work?", "Add your domain in the project and create the CNAME (or an A record for apex domains) that Orb shows you. Pointing DNS at Orb proves ownership, and HTTPS is provisioned automatically."],
  ["How do teams and invitations work?", "Create a team, enter a teammate's e-mail and pick a role. They get a link by e-mail, sign in with the GitHub account that uses that address and accept. Teams need a paid plan to have more than one member."],
  ["How do I pay, and does it renew automatically?", "Payments run through Razorpay (UPI, cards, netbanking). A plan is prepaid for a month or a year and never renews on its own; we e-mail you 7, 3 and 1 days before it ends, and renewing early simply adds time."],
  ["What alerts will I get?", "A deployment finished or failed, a custom domain went live or lost its DNS, a service lost an instance, a teammate joined, a payment was received and a plan is ending. Each shows in the dashboard bell; you choose which categories are also e-mailed."],
  ["Is there downtime when I deploy?", "No. A new release only receives traffic after its instances pass health checks. If something fails, the previous deployment keeps serving."],
  ["How are my secrets protected?", "Environment variables are encrypted at rest, bound to their project, masked in build logs and — when marked sensitive — never returned by the API."],
  ["Can I self-host Orb?", "Yes. Orb is built to run on your own infrastructure — a single server to start, then add worker and runner machines as you grow."],
];

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-24">
      <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl" data-reveal>Frequently asked questions</h2>
      <div className="mt-10 divide-y rounded-2xl border bg-card shadow-sm" data-reveal>
        {FAQ.map(([q, a]) => (
          <details key={q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
              {q}
              <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="px-5 pb-24">
      <div data-reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-accent/50 blur-[90px]" aria-hidden />
        <div className="relative">
          <Sparkles className="mx-auto size-6 opacity-80" />
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Ship your next project on Orb</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm opacity-80">Import a repository and have a live HTTPS URL before your coffee cools. Free on the Hobby plan.</p>
          <Button asChild size="lg" variant="secondary" className="mt-9 h-12 bg-background px-7 text-base text-foreground hover:bg-background/90">
            <Link href={signedIn ? "/dashboard" : "/login"}>
              {signedIn ? "Open dashboard" : "Get started free"} <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
        <Logo size={22} />
        <nav className="flex flex-wrap justify-center gap-5" aria-label="Footer">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <p>© {new Date().getFullYear()} Orb</p>
      </div>
      <p className="mx-auto max-w-6xl px-5 pb-6 text-center text-[11px] text-muted-foreground/70">
        Tour music: &ldquo;Happy Beats / Business Moves Vol. 1&rdquo; by Sascha Ende (
        <a className="underline underline-offset-2" href="https://ende.app/en" rel="noreferrer">ende.app</a>
        ), licensed under{" "}
        <a className="underline underline-offset-2" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC BY 4.0</a>.
      </p>
    </footer>
  );
}
