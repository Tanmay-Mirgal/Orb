"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Check, Cog, Globe, KeyRound, Lock, Menu, RotateCcw, Server, ShieldCheck, Timer, Users, X, Zap,
} from "lucide-react";
import { INSTANCE_PLANS, ORG_PLANS } from "shared";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/app/page";
import { ThemeToggle } from "@/components/app/theme";

const NAV = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export function LandingClient() {
  const { data: session } = useSession();
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <Navbar signedIn={Boolean(session)} />
      <main>
        <Hero signedIn={Boolean(session)} />
        <Stack />
        <Features />
        <HowItWorks />
        <Pricing />
        <Faq />
        <FinalCta signedIn={Boolean(session)} />
      </main>
      <Footer />
    </div>
  );
}

function Navbar({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
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

const LOG = [
  ["text-muted-foreground", "$ git push origin main"],
  ["text-muted-foreground", "[git]     Cloning acme/storefront@main"],
  ["text-muted-foreground", "[detect]  Next.js (node) → web service"],
  ["text-muted-foreground", "[docker]  Building image in an isolated container…"],
  ["text-muted-foreground", "[docker]  Image built · 38 s"],
  ["text-muted-foreground", "[sched]   Starting 2 instances on node-1, node-2"],
  ["text-success", "✓ Instance 4f9a21c0 healthy"],
  ["text-success", "✓ Live: traffic switched — zero downtime"],
];

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[560px]" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:pt-24">
        <Badge variant="accent" className="mx-auto">
          <Zap className="size-3" /> Deploy static sites, services, workers & cron jobs
        </Badge>
        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          From <span className="text-accent">git push</span> to production in seconds.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          Orb builds your repository, ships it behind automatic HTTPS and scales it across machines — with custom domains, instant rollbacks and zero-downtime releases. No servers to manage.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href={signedIn ? "/dashboard" : "/login"}>
              {signedIn ? "Open dashboard" : "Start deploying free"} <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#how">See how it works</a>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Sign in with GitHub · no credit card · free Hobby plan</p>

        <div className="mx-auto mt-14 max-w-3xl overflow-hidden rounded-2xl border bg-card text-left shadow-lg">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <span className="size-2.5 rounded-full bg-destructive/70" />
            <span className="size-2.5 rounded-full bg-warning/70" />
            <span className="size-2.5 rounded-full bg-success/70" />
            <span className="ml-3 truncate font-mono text-xs text-muted-foreground">orb · deployment 4f9a21c0</span>
            <Badge variant="success" dot className="ml-auto">Ready</Badge>
          </div>
          <div className="space-y-1.5 bg-[#0a0a0c] p-5 font-mono text-[12.5px] leading-6 text-zinc-300">
            {LOG.map(([tone, line], i) => (
              <p key={i} className={`animate-fade-up ${tone === "text-success" ? "text-emerald-400" : "text-zinc-400"}`} style={{ animationDelay: `${i * 320}ms` }}>
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stack() {
  const items = ["Next.js", "React", "Vue", "Astro", "Node.js", "Python", "Go", "Docker"];
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

const FEATURES = [
  { icon: Zap, title: "Git-driven deploys", text: "Push to deploy. Every branch can get its own preview URL, every commit an immutable deployment." },
  { icon: Server, title: "Services, workers & cron", text: "Run web services, background workers and scheduled jobs next to your static sites — from a repo or your own Dockerfile." },
  { icon: RotateCcw, title: "Instant rollbacks", text: "New releases only get traffic once they are healthy. Roll back to any previous deployment in a click." },
  { icon: Globe, title: "Custom domains & HTTPS", text: "Bring your own domain. Ownership is verified over DNS and certificates are issued and renewed automatically." },
  { icon: Lock, title: "Secrets done right", text: "Environment variables are encrypted at rest, scoped per environment, and never shown again once saved." },
  { icon: BarChart3, title: "Logs & analytics", text: "Live build and runtime logs, plus request, bandwidth and latency analytics for every project." },
  { icon: Users, title: "Teams & roles", text: "Invite teammates with owner, admin, member or viewer roles. Every sensitive action lands in the audit log." },
  { icon: KeyRound, title: "API & tokens", text: "Everything in the dashboard is available through a REST API with personal access tokens for CI." },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Everything you need to run in production</h2>
        <p className="mt-3 text-muted-foreground">The workflow of a modern PaaS, on infrastructure you control.</p>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <f.icon className="size-5" />
            </span>
            <h3 className="mt-4 text-[15px] font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, icon: Cog, title: "Connect a repository", text: "Sign in with GitHub and pick a repo. Orb detects the framework and fills in build, start and port settings." },
    { n: 2, icon: Timer, title: "We build & release", text: "Your app is built in an isolated container, started on a healthy node, and only then promoted to production." },
    { n: 3, icon: ShieldCheck, title: "Go live on your domain", text: "Add your domain, create two DNS records and get HTTPS automatically. Push again any time — or roll back." },
  ];
  return (
    <section id="how" className="scroll-mt-20 border-y bg-card/40 py-20">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight sm:text-4xl">Live in three steps</h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="relative rounded-xl border bg-card p-6 shadow-sm">
              <span className="absolute -top-3 left-6 flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{s.n}</span>
              <s.icon className="mt-2 size-6 text-accent" />
              <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = Object.values(ORG_PLANS);
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Simple, predictable pricing</h2>
        <p className="mt-3 text-muted-foreground">Start free. Upgrade when you need more projects, bigger instances or a team.</p>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {plans.map((p) => {
          const popular = p.id === "pro";
          const largest = INSTANCE_PLANS[p.allowedInstancePlans[p.allowedInstancePlans.length - 1]!]!;
          const features = [
            `${p.maxProjects} projects`,
            `${p.maxMembers} team member${p.maxMembers === 1 ? "" : "s"}`,
            `${p.maxDomainsPerProject} custom domains per project`,
            `Up to ${largest.name} instances (${largest.cpuMillis / 1000} vCPU, ${largest.memoryMb >= 1024 ? `${largest.memoryMb / 1024} GB` : `${largest.memoryMb} MB`})`,
            `Up to ${p.maxInstancesPerService} instance${p.maxInstancesPerService === 1 ? "" : "s"} per service`,
            `${p.maxConcurrentBuilds} concurrent build${p.maxConcurrentBuilds === 1 ? "" : "s"}`,
            p.previewDeployments ? "Preview deployments" : "Production deployments",
          ];
          return (
            <div key={p.id} className={`relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm ${popular ? "border-accent ring-2 ring-accent/20" : ""}`}>
              {popular && <Badge variant="accent" className="absolute -top-3 left-6">Most popular</Badge>}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-3 text-4xl font-semibold tracking-tight">
                ${p.priceUsdMonth}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 text-[13px]">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8 w-full" variant={popular ? "accent" : "outline"} size="lg">
                <Link href="/login">{p.priceUsdMonth === 0 ? "Start free" : `Choose ${p.name}`}</Link>
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const FAQ = [
  ["What can I deploy?", "Static sites (Vite, React, Astro, Docusaurus, plain HTML), SSR apps (Next.js, Nuxt, Remix), backend services (Node, Python, Go) and anything with a Dockerfile. You can also run background workers and cron jobs."],
  ["How do custom domains work?", "Add your domain in the project, create the TXT record that proves ownership and a CNAME (or A record for apex domains). Orb verifies DNS automatically and provisions HTTPS."],
  ["Is there downtime when I deploy?", "No. A new release only receives traffic after its instances pass health checks. If something fails, the previous deployment keeps serving."],
  ["How are my secrets protected?", "Environment variables are encrypted at rest, bound to their project, masked in build logs and — when marked sensitive — never returned by the API."],
  ["Can I use it from CI?", "Yes. Create a personal access token and call the REST API, or just push to Git: the GitHub webhook triggers deployments automatically."],
  ["Can I self-host Orb?", "Yes. Orb is built to run on your own infrastructure — a single server to start, then add worker and runner machines as you grow."],
];

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 pb-20">
      <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Frequently asked questions</h2>
      <div className="mt-10 divide-y rounded-2xl border bg-card shadow-sm">
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
    <section className="px-5 pb-20">
      <div className="mx-auto max-w-4xl rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Ship your next project on Orb</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm opacity-80">Import a repository and have a live HTTPS URL before your coffee cools.</p>
        <Button asChild size="lg" variant="secondary" className="mt-8 bg-background text-foreground hover:bg-background/90">
          <Link href={signedIn ? "/dashboard" : "/login"}>
            {signedIn ? "Open dashboard" : "Get started free"} <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
        <Logo size={22} />
        <nav className="flex gap-5" aria-label="Footer">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <p>© {new Date().getFullYear()} Orb</p>
      </div>
    </footer>
  );
}
