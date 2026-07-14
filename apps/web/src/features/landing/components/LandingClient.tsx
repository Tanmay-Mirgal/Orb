"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "@/lib/auth-client";
import {
  GitBranch, Zap, Shield, Globe, ArrowRight, Menu, X,
  CheckCircle2, Terminal as TerminalIcon, Clock, BarChart3
} from "lucide-react";

export function LandingClient() {
  const { data: session } = useSession();
  return (
    <div className="bg-[#09090b] text-white min-h-screen antialiased overflow-x-hidden">
      <Navbar session={session} />
      <Hero session={session} />
      <SocialProof />
      <Features />
      <DeployFlow />
      <FinalCTA session={session} />
      <Footer />
    </div>
  );
}

/* ─────────────────────── NAVBAR ─────────────────────── */
function Navbar({ session }: { session: any }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
      scrolled ? "bg-[#09090b]/80 backdrop-blur-xl border-b border-zinc-800/60" : ""
    }`}>
      <div className="max-w-6xl mx-auto px-5 h-[60px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo.png" alt="Orb" width={26} height={26} className="rounded-[7px]" />
          <span className="text-[15px] font-semibold tracking-tight text-white">Orb</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {["Features", "Docs", "Changelog", "Pricing"].map((item) => (
            <Link
              key={item}
              href={item === "Features" ? "#features" : "#"}
              className="px-3.5 py-1.5 text-[13px] text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800/60 transition-all duration-150"
            >
              {item}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          {session ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-[13px] font-semibold bg-white text-black h-8 px-4 rounded-full hover:bg-zinc-100 transition-colors"
            >
              Dashboard <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-[13px] text-zinc-400 hover:text-white transition-colors h-8 px-3 flex items-center">
                Log in
              </Link>
              <Link
                href="/login"
                className="flex items-center gap-1.5 text-[13px] font-semibold bg-white text-black h-8 px-4 rounded-full hover:bg-zinc-100 transition-colors"
              >
                Start for free <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>

        <button className="md:hidden p-1.5 text-zinc-400 hover:text-white" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-[#09090b] border-b border-zinc-800/60 px-5 pb-5 pt-3 flex flex-col gap-1">
          {["Features", "Docs", "Changelog", "Pricing"].map((item) => (
            <Link key={item} href="#" onClick={() => setOpen(false)}
              className="text-[14px] text-zinc-400 hover:text-white py-2 px-3 rounded-md hover:bg-zinc-800/60">{item}</Link>
          ))}
          <div className="mt-3 pt-3 border-t border-zinc-800/60">
            <Link href="/login" className="block w-full text-center bg-white text-black text-[13px] font-semibold py-2.5 rounded-full">
              Start for free
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ─────────────────────── HERO ─────────────────────── */
function Hero({ session }: { session: any }) {
  return (
    <section className="relative pt-32 pb-20 px-5 overflow-hidden">
      {/* Gradient top glow */}
      <div aria-hidden className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-zinc-600/50 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px]"
        style={{ background: "radial-gradient(ellipse at top, rgba(99,102,241,0.08) 0%, transparent 60%)" }} />

      <div className="max-w-4xl mx-auto text-center">
        {/* Announcement chip */}
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-4 py-1.5 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-[12px] font-medium text-indigo-300">Built for developers who ship fast</span>
        </div>

        <h1 className="text-[clamp(2.6rem,6.5vw,5rem)] font-black tracking-tight leading-[1.06] mb-6 text-white">
          The deployment platform<br />
          <span className="bg-gradient-to-b from-zinc-300 to-zinc-500 bg-clip-text text-transparent">
            your team will love.
          </span>
        </h1>

        <p className="text-[16px] md:text-[17px] text-zinc-400 leading-[1.75] max-w-2xl mx-auto mb-10">
          Orb is a self-hosted platform that turns every git push into a live deployment.
          Automatic builds, wildcard SSL, real-time logs — fully on your own infrastructure.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
          {session ? (
            <Link href="/dashboard"
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold h-[44px] px-7 rounded-full transition-colors shadow-[0_0_0_1px_rgba(99,102,241,0.5),0_8px_30px_rgba(99,102,241,0.25)]">
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link href="/login"
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold h-[44px] px-7 rounded-full transition-colors shadow-[0_0_0_1px_rgba(99,102,241,0.5),0_8px_30px_rgba(99,102,241,0.25)]">
                Start deploying free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="https://github.com"
                className="flex items-center gap-2 text-[14px] font-medium text-zinc-300 hover:text-white h-[44px] px-6 rounded-full border border-zinc-700/70 hover:border-zinc-600 bg-zinc-800/40 hover:bg-zinc-800/80 transition-all">
                <GitBranch className="h-4 w-4" /> View on GitHub
              </Link>
            </>
          )}
        </div>

        <p className="text-[12px] text-zinc-600">
          No credit card · Self-host in 15 minutes · MIT License
        </p>
      </div>

      {/* Terminal card */}
      <div className="relative max-w-2xl mx-auto mt-16">
        <div aria-hidden className="absolute -inset-px rounded-2xl bg-gradient-to-b from-zinc-700/50 to-transparent pointer-events-none" />
        <TerminalCard />
      </div>
    </section>
  );
}

/* ─────────────────────── TERMINAL ─────────────────────── */
const LOG_LINES = [
  { t: "cmd",  txt: "$ git push origin main" },
  { t: "muted",txt: "Triggered by: push on main  ·  Orb v1.0" },
  { t: "sep",  txt: "" },
  { t: "info", txt: "▸  Detecting framework..." },
  { t: "ok",   txt: "✓  Next.js 16 detected" },
  { t: "info", txt: "▸  Provisioning container (512MB · 1.0 CPU)" },
  { t: "ok",   txt: "✓  Dependencies installed  [18s]" },
  { t: "ok",   txt: "✓  Production build complete  [34s]" },
  { t: "ok",   txt: "✓  Artifact uploaded to MinIO" },
  { t: "ok",   txt: "✓  SSL certificate issued via Caddy" },
  { t: "sep",  txt: "" },
  { t: "live", txt: "🚀  Deployed → https://my-app.orb.tanmaymirgal.dev" },
];

function TerminalCard() {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (n >= LOG_LINES.length) return;
    const d = n === 0 ? 700 : LOG_LINES[n - 1].t === "sep" ? 200 : 500;
    const id = setTimeout(() => setN(c => c + 1), d);
    return () => clearTimeout(id);
  }, [n]);

  const cls: Record<string, string> = {
    cmd:   "text-white font-mono font-semibold",
    muted: "text-zinc-600 font-mono text-[11px]",
    info:  "text-zinc-400 font-mono",
    ok:    "text-emerald-400 font-mono",
    live:  "text-indigo-300 font-mono font-semibold",
    sep:   "h-3",
  };

  return (
    <div className="rounded-2xl bg-[#0d0d10] border border-zinc-800/70 overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
      {/* Window bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60 bg-zinc-900/30">
        <span className="w-3 h-3 rounded-full bg-zinc-700" />
        <span className="w-3 h-3 rounded-full bg-zinc-700" />
        <span className="w-3 h-3 rounded-full bg-zinc-700" />
        <div className="ml-auto flex items-center gap-2">
          <Image src="/logo.png" alt="" width={14} height={14} className="rounded opacity-60" />
          <span className="text-[11px] text-zinc-500 font-mono">Build #47 · main</span>
        </div>
      </div>

      <div className="px-5 py-5 text-[12.5px] leading-[1.8] min-h-[230px] space-y-0.5">
        {LOG_LINES.slice(0, n).map((line, i) =>
          line.t === "sep" ? (
            <div key={i} className="h-3" />
          ) : (
            <div key={i} className={cls[line.t]}>{line.txt}</div>
          )
        )}
        {n < LOG_LINES.length && (
          <span className="inline-block w-[6px] h-[13px] bg-indigo-400/70 animate-[blink_1s_step-end_infinite] align-text-bottom" />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── SOCIAL PROOF ─────────────────────── */
function SocialProof() {
  const stats = [
    { value: "< 60s", label: "Avg. deploy time" },
    { value: "100%", label: "Infra ownership" },
    { value: "∞", label: "Projects supported" },
    { value: "$0", label: "Platform fee" },
  ];

  return (
    <div className="border-y border-zinc-800/50 bg-zinc-900/20">
      <div className="max-w-6xl mx-auto px-5 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        {stats.map((s, i) => (
          <div key={i} className="text-center">
            <div className="text-3xl md:text-4xl font-black text-white mb-1.5 tracking-tight">{s.value}</div>
            <div className="text-[12px] text-zinc-500 font-medium uppercase tracking-widest">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── FEATURES ─────────────────────── */
const FEATURES = [
  {
    icon: GitBranch,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
    title: "Git-driven deploys",
    desc: "Every push to GitHub triggers an automated build. Branch previews, production releases, and rollbacks — all from your existing workflow.",
  },
  {
    icon: Globe,
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
    title: "Automatic HTTPS & subdomains",
    desc: "Caddy provisions TLS certificates on-demand via Let's Encrypt. Your projects live at myapp.orb.yourdomain.com — secured from day one.",
  },
  {
    icon: TerminalIcon,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    title: "Real-time build logs",
    desc: "Stream every log line as it happens directly from the build container. Powered by Redis pub-sub — no polling, zero delay.",
  },
  {
    icon: Shield,
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    title: "Sandboxed build containers",
    desc: "Builds run in isolated Docker containers with configurable memory and CPU limits. Secure by default, configurable by need.",
  },
  {
    icon: Zap,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/20",
    title: "Encrypted environment variables",
    desc: "Inject secrets per project. All environment variables are encrypted at rest using AES before storage in PostgreSQL.",
  },
  {
    icon: BarChart3,
    color: "text-pink-400",
    bg: "bg-pink-500/10 border-pink-500/20",
    title: "Multi-worker build queue",
    desc: "Scale horizontally by adding worker nodes. BullMQ distributes build jobs across all workers via Redis. Stateless and elastic.",
  },
];

function Features() {
  return (
    <section id="features" className="py-28 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-400 mb-4">Platform</p>
          <h2 className="text-3xl md:text-[2.6rem] font-black tracking-tight text-white mb-4 leading-tight">
            Everything your team needs<br className="hidden md:block" /> to ship confidently.
          </h2>
          <p className="text-[15px] text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Orb handles the entire deployment lifecycle — from git push to a live, secured URL — on your own servers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="group rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6 hover:bg-zinc-900/60 hover:border-zinc-700/70 transition-all duration-200"
            >
              <div className={`w-9 h-9 rounded-lg border ${f.bg} flex items-center justify-center mb-5`}>
                <f.icon className={`h-4 w-4 ${f.color}`} strokeWidth={1.75} />
              </div>
              <h3 className="text-[14px] font-bold text-white mb-2">{f.title}</h3>
              <p className="text-[13px] text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── DEPLOY FLOW ─────────────────────── */
const STEPS = [
  {
    num: "1",
    icon: GitBranch,
    title: "Connect your repository",
    desc: "Install the Orb GitHub App on any repository. One click — no YAML, no config files, no Docker knowledge required.",
    tag: "GitHub App",
  },
  {
    num: "2",
    icon: Clock,
    title: "Push → build → live",
    desc: "Every git push triggers a build inside a sandboxed container. Your app is built, zipped, stored in MinIO, and served through the edge proxy.",
    tag: "< 60 seconds",
  },
  {
    num: "3",
    icon: Globe,
    title: "Manage from the dashboard",
    desc: "Monitor deployments, stream build logs, manage custom domains, set environment variables, and roll back — all from one clean UI.",
    tag: "Real-time",
  },
];

function DeployFlow() {
  return (
    <section className="py-28 px-5 bg-zinc-950/50 border-y border-zinc-800/40">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-400 mb-4">How it works</p>
          <h2 className="text-3xl md:text-[2.6rem] font-black tracking-tight text-white mb-4 leading-tight">
            From zero to deployed<br className="hidden md:block" /> in three steps.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((s, i) => (
            <div key={i} className="relative rounded-2xl border border-zinc-800/60 bg-[#0d0d10] p-7">
              {/* Step number */}
              <div className="flex items-center justify-between mb-6">
                <div className="w-9 h-9 rounded-full border border-indigo-500/30 bg-indigo-500/10 flex items-center justify-center text-[13px] font-black text-indigo-400">
                  {s.num}
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 border border-zinc-800 rounded-full px-3 py-1">
                  {s.tag}
                </span>
              </div>
              <h3 className="text-[15px] font-bold text-white mb-2.5">{s.title}</h3>
              <p className="text-[13px] text-zinc-500 leading-relaxed">{s.desc}</p>

              {/* Connector arrow (between cards) */}
              {i < STEPS.length - 1 && (
                <div className="hidden md:flex absolute -right-3.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 items-center justify-center">
                  <ArrowRight className="h-3.5 w-3.5 text-zinc-500" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Included checklist */}
        <div className="mt-12 pt-10 border-t border-zinc-800/40">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-600 mb-6 text-center">Included out of the box</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-w-3xl mx-auto">
            {[
              "Automatic framework detection",
              "Docker-sandboxed builds",
              "Wildcard SSL via Caddy",
              "MinIO artifact storage",
              "Real-time log streaming",
              "Encrypted env variables",
              "Multi-worker build queue",
              "Custom domain support",
              "One-click rollbacks",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-[13px] text-zinc-400">
                <CheckCircle2 className="h-4 w-4 text-indigo-500 shrink-0" strokeWidth={2} />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── FINAL CTA ─────────────────────── */
function FinalCTA({ session }: { session: any }) {
  return (
    <section className="py-28 px-5">
      <div className="max-w-3xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 mb-7">
          <Image src="/logo.png" alt="Orb" width={32} height={32} className="rounded-lg" />
        </div>
        <h2 className="text-3xl md:text-[2.6rem] font-black tracking-tight text-white mb-5 leading-tight">
          Deploy your first project<br />in under 15 minutes.
        </h2>
        <p className="text-[15px] text-zinc-400 mb-10 leading-relaxed max-w-lg mx-auto">
          Self-host Orb on any Linux server. One `.env` file, one `docker compose up` — and you're live.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {session ? (
            <Link href="/dashboard"
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold h-[46px] px-8 rounded-full transition-colors shadow-[0_0_0_1px_rgba(99,102,241,0.5),0_12px_40px_rgba(99,102,241,0.3)]">
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link href="/login"
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold h-[46px] px-8 rounded-full transition-colors shadow-[0_0_0_1px_rgba(99,102,241,0.5),0_12px_40px_rgba(99,102,241,0.3)]">
                Get started free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="https://github.com"
                className="flex items-center gap-2 text-[14px] font-medium text-zinc-300 hover:text-white h-[46px] px-7 rounded-full border border-zinc-700 hover:border-zinc-600 bg-zinc-800/40 hover:bg-zinc-800 transition-all">
                <GitBranch className="h-4 w-4" /> Star on GitHub
              </Link>
            </>
          )}
        </div>

        <p className="mt-6 text-[12px] text-zinc-600">
          MIT License · No credit card · Self-hosted on your infrastructure
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────── FOOTER ─────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-zinc-800/50 px-5 py-8">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5 text-[12px] text-zinc-600">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="Orb" width={16} height={16} className="rounded opacity-50" />
          <span>Orb Platform</span>
        </div>
        <span>© {new Date().getFullYear()} Orb. Built by Tanmay Mirgal.</span>
        <div className="flex items-center gap-6">
          <Link href="https://github.com" className="hover:text-zinc-300 transition-colors">GitHub</Link>
          <Link href="#" className="hover:text-zinc-300 transition-colors">Docs</Link>
          <Link href="#" className="hover:text-zinc-300 transition-colors">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}
