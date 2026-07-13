"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { Button } from "@/components/ui/button";
import { 
  Zap, GitBranch, Play, Terminal, Globe, 
  Server, Shield, Box, Bot, Activity, ArrowRight,
  Database, Cpu, CheckCircle2, ChevronRight, Menu, X, RefreshCcw, LogOut, Settings as SettingsIcon
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { useSession, signOut } from "@/lib/auth-client";

export function LandingClient() {
  const { scrollY } = useScroll();
  const opacityHero = useTransform(scrollY, [0, 500], [1, 0]);
  const yHero = useTransform(scrollY, [0, 500], [0, 100]);
  const { data: session } = useSession();
  
  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-accent/30 selection:text-white overflow-hidden font-sans">
      <Navbar session={session} />
      
      <main className="relative z-10 flex flex-col items-center w-full">
        <motion.div style={{ opacity: opacityHero, y: yHero }} className="w-full">
          <HeroSection session={session} />
        </motion.div>
        
        <BentoFeaturesSection />
        <InfrastructureGraphSection />
        <AIAndAnalyticsSection />
        <PricingSection />
      </main>

      <Footer />
    </div>
  );
}

// --------------------------------------------------------------------------------
// NAVBAR
// --------------------------------------------------------------------------------
function Navbar({ session }: { session: any }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#050505]/80 backdrop-blur-xl border-b border-white/[0.08] py-3' : 'bg-transparent py-5'}`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[8px] flex items-center justify-center border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.3)] overflow-hidden bg-[#0A0A0A]">
            <Image src="/logo.png" alt="Orb Logo" width={32} height={32} className="object-cover" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Orb</span>
        </div>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
          <Link href="#features" className="hover:text-white transition-colors">Features</Link>
          <Link href="#infrastructure" className="hover:text-white transition-colors">Platform</Link>
          <Link href="#pricing" className="hover:text-white transition-colors">Pricing</Link>
          <Link href="#" className="hover:text-white transition-colors">Enterprise</Link>
        </nav>

        <div className="hidden md:flex items-center gap-4">
          {!session ? (
            <>
              <Link href="/login" className="text-sm font-medium text-white/70 hover:text-white transition-colors">Log In</Link>
              <Button className="h-9 rounded-[8px] bg-white text-black hover:bg-white/90 font-medium px-4 transition-all hover:scale-105 active:scale-95" asChild>
                <Link href="/login">Get Started</Link>
              </Button>
            </>
          ) : (
            <div className="relative">
              <button 
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 hover:bg-white/5 p-1.5 rounded-full pr-3 transition-colors border border-transparent hover:border-white/10"
              >
                <div className="relative">
                  <img src={session.user.image || `https://avatar.vercel.sh/${session.user.email}`} alt="Avatar" className="w-7 h-7 rounded-full border border-white/20" />
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#050505] rounded-full"></div>
                </div>
                <span className="text-sm font-medium">{session.user.name || 'User'}</span>
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 top-full mt-2 w-48 bg-[#0A0A0A] border border-white/10 rounded-[12px] shadow-2xl p-1 z-50 flex flex-col"
                  >
                    <Link href="/dashboard" className="px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-[8px] flex items-center gap-2 transition-colors"><Box className="h-4 w-4" /> Dashboard</Link>
                    <Link href="/dashboard/settings" className="px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/5 rounded-[8px] flex items-center gap-2 transition-colors"><SettingsIcon className="h-4 w-4" /> Settings</Link>
                    <div className="h-[1px] bg-white/10 my-1 mx-2"></div>
                    <button 
                      onClick={async () => { await signOut(); window.location.href = "/"; }}
                      className="px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-[8px] flex items-center gap-2 transition-colors w-full text-left"
                    >
                      <LogOut className="h-4 w-4" /> Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        <button className="md:hidden text-white" onClick={() => setMobileMenu(!mobileMenu)}>
          {mobileMenu ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenu && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 right-0 bg-[#050505] border-b border-white/[0.08] p-6 flex flex-col gap-4 md:hidden shadow-2xl"
          >
            <Link href="#features" className="text-sm font-medium hover:text-white transition-colors">Features</Link>
            <Link href="#pricing" className="text-sm font-medium hover:text-white transition-colors">Pricing</Link>
            {!session ? (
              <>
                <Link href="/login" className="text-sm font-medium hover:text-white transition-colors">Log In</Link>
                <Button className="w-full h-10 rounded-[8px] bg-white text-black font-medium" asChild>
                  <Link href="/login">Get Started</Link>
                </Button>
              </>
            ) : (
              <>
                <div className="h-[1px] bg-white/10 my-2"></div>
                <Link href="/dashboard" className="text-sm font-medium hover:text-white transition-colors">Dashboard</Link>
                <Link href="/dashboard/settings" className="text-sm font-medium hover:text-white transition-colors">Settings</Link>
                <button onClick={() => signOut()} className="text-sm font-medium text-red-400 text-left">Sign Out</button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

// --------------------------------------------------------------------------------
// HERO SECTION
// --------------------------------------------------------------------------------
function HeroSection({ session }: { session: any }) {
  return (
    <section className="relative pt-40 pb-20 md:pt-52 md:pb-32 px-6 w-full flex flex-col items-center justify-center min-h-screen">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_70%,transparent_100%)]"></div>
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[800px] rounded-full bg-[#4F7CFF] opacity-10 blur-[120px]"></div>
        <div className="absolute left-1/4 top-1/4 h-[300px] w-[400px] rounded-full bg-purple-600 opacity-5 blur-[100px]"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-5xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="inline-flex items-center rounded-full border border-white/10 px-3 py-1 text-xs font-medium mb-8 bg-white/[0.03] backdrop-blur-md shadow-[0_0_20px_rgba(255,255,255,0.05)]"
        >
          <span className="flex h-1.5 w-1.5 rounded-full bg-[#4F7CFF] mr-2 animate-pulse shadow-[0_0_10px_#4F7CFF]"></span>
          <span className="text-white/80">AI Powered Cloud Platform</span>
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
          className="text-6xl md:text-8xl font-extrabold tracking-tighter mb-6 leading-[1.1] bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/50"
        >
          Deploy Anything.<br/>Scale Everything.<br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4F7CFF] to-purple-400">Powered by AI.</span>
        </motion.h1>

        <motion.p 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}
          className="text-lg md:text-xl text-white/50 mb-10 max-w-2xl leading-relaxed font-light tracking-wide"
        >
          Deploy full-stack applications, Docker containers, APIs, AI models, databases and edge workers worldwide in seconds. Zero configuration required.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center"
        >
          {session ? (
            <Button className="h-12 px-8 rounded-[8px] bg-white text-black hover:bg-white/90 font-medium text-base shadow-[0_0_40px_rgba(255,255,255,0.2)] transition-all hover:scale-105 active:scale-95 group" asChild>
              <Link href="/dashboard">
                Open Dashboard <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          ) : (
            <>
              <Button className="h-12 px-8 rounded-full bg-white text-black hover:bg-white/90 font-medium text-base shadow-[0_0_40px_rgba(255,255,255,0.2)] transition-all hover:scale-105 active:scale-95 group" asChild>
                <Link href="/login">
                  Start Deploying <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button variant="outline" className="h-12 px-8 rounded-full border-white/10 bg-white/[0.03] hover:bg-white/10 text-white font-medium text-base backdrop-blur-md transition-all">
                <GitBranch className="mr-2 h-4 w-4" /> Import from GitHub
              </Button>
            </>
          )}
        </motion.div>
      </div>

      {/* Live Terminal Animation */}
      <motion.div 
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.5 }}
        className="relative z-10 w-full max-w-3xl mt-20"
      >
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-b from-white/10 to-transparent opacity-30 blur-md pointer-events-none"></div>
        <div className="rounded-[16px] border border-white/10 bg-[#0A0A0A]/80 backdrop-blur-2xl shadow-2xl overflow-hidden relative">
          <div className="flex items-center px-4 py-3 border-b border-white/5 bg-white/[0.02]">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/80"></div>
              <div className="h-3 w-3 rounded-full bg-yellow-500/80"></div>
              <div className="h-3 w-3 rounded-full bg-green-500/80"></div>
            </div>
            <div className="mx-auto text-xs font-mono text-white/30 flex items-center gap-2"><Globe className="h-3 w-3" /> orb deploy</div>
          </div>
          <div className="p-6 font-mono text-sm min-h-[200px]">
            <TerminalTypingEffect />
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// ... Rest of the file remains exactly the same ...
// Terminal Typing Hook Simulation
function TerminalTypingEffect() {
  const lines = [
    { text: "$ git push origin main", delay: 0, color: "text-white" },
    { text: "Building Orb Platform...", delay: 800, color: "text-[#4F7CFF]" },
    { text: "✓ Detected Next.js framework", delay: 1500, color: "text-white/60" },
    { text: "✓ Provisioning isolated container", delay: 2000, color: "text-white/60" },
    { text: "✓ Installing dependencies", delay: 2800, color: "text-white/60" },
    { text: "✓ Running build output...", delay: 3500, color: "text-white/60" },
    { text: "Deploying to Global Edge (iad1, sfo1, fra1)...", delay: 4500, color: "text-[#4F7CFF]" },
    { text: "✓ SSL Certificate provisioned", delay: 5200, color: "text-white/60" },
    { text: "🚀 Live at https://orb.dev", delay: 6000, color: "text-green-400 font-bold" },
  ];

  const [visibleLines, setVisibleLines] = useState<number>(0);

  useEffect(() => {
    let timeouts: NodeJS.Timeout[] = [];
    lines.forEach((line, index) => {
      const timeout = setTimeout(() => {
        setVisibleLines(prev => Math.max(prev, index + 1));
      }, line.delay);
      timeouts.push(timeout);
    });

    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {lines.slice(0, visibleLines).map((line, i) => (
        <motion.div 
          key={i} 
          initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.1 }}
          className={`${line.color} flex items-center gap-3`}
        >
          {line.text}
        </motion.div>
      ))}
      {visibleLines < lines.length && (
        <motion.div animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} className="h-4 w-2 bg-white/50 mt-1"></motion.div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------
// BENTO GRID FEATURES
// --------------------------------------------------------------------------------
function BentoFeaturesSection() {
  return (
    <section id="features" className="py-32 px-6 max-w-7xl mx-auto w-full relative z-10">
      <div className="text-center mb-20 max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Built for scale.<br/>Designed for humans.</h2>
        <p className="text-lg text-white/50 leading-relaxed">Orb abstracts away the complexity of cloud infrastructure, giving you an elegant interface over powerful primitive services.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-[300px]">
        <div className="md:col-span-2 lg:col-span-2 row-span-2 rounded-[24px] border border-white/10 bg-white/[0.02] p-8 flex flex-col justify-between overflow-hidden relative group hover:border-white/20 transition-colors">
          <div className="absolute inset-0 bg-gradient-to-br from-[#4F7CFF]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="relative z-10">
            <div className="h-12 w-12 rounded-[12px] bg-white/10 flex items-center justify-center mb-6">
              <Globe className="h-6 w-6 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Global Edge Network</h3>
            <p className="text-white/50">Your application is automatically replicated across 35 regions globally. Requests are routed to the nearest node for sub-50ms latency anywhere in the world.</p>
          </div>
          <div className="relative z-10 w-full h-48 mt-8 border border-white/10 rounded-[12px] bg-[#0A0A0A] overflow-hidden flex items-center justify-center">
            <svg viewBox="0 0 400 200" className="w-full h-full opacity-30">
              <path d="M50 80 Q 150 20 250 80 T 350 80" fill="none" stroke="#4F7CFF" strokeWidth="2" strokeDasharray="5,5" />
              <circle cx="50" cy="80" r="4" fill="#4F7CFF" className="animate-pulse" />
              <circle cx="250" cy="80" r="4" fill="#4F7CFF" className="animate-pulse" />
              <circle cx="350" cy="80" r="4" fill="#4F7CFF" className="animate-pulse" />
            </svg>
          </div>
        </div>

        <div className="md:col-span-1 lg:col-span-2 rounded-[24px] border border-white/10 bg-white/[0.02] p-8 flex flex-col justify-between relative group hover:border-white/20 transition-colors">
          <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="relative z-10">
            <div className="h-10 w-10 rounded-[10px] bg-white/10 flex items-center justify-center mb-4">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-xl font-bold mb-2">AI-Powered DevOps</h3>
            <p className="text-white/50 text-sm">Orb AI automatically detects frameworks, writes Dockerfiles, and resolves build errors instantly.</p>
          </div>
        </div>

        {[
          { title: "Zero Downtime", icon: RefreshCcw, desc: "Seamless blue-green deployments." },
          { title: "Docker Native", icon: Box, desc: "Deploy any containerized app." },
          { title: "Serverless Workers", icon: Zap, desc: "Run code at the edge." },
          { title: "Instant Rollbacks", icon: Activity, desc: "Revert to any state in 1 click." }
        ].map((f, i) => (
          <div key={i} className="rounded-[24px] border border-white/10 bg-white/[0.02] p-8 flex flex-col justify-between relative group hover:border-white/20 transition-colors">
            <div className="h-10 w-10 rounded-[10px] bg-white/5 flex items-center justify-center">
              <f.icon className="h-5 w-5 text-white/70" />
            </div>
            <div>
              <h3 className="text-lg font-bold mb-1">{f.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------
// INFRASTRUCTURE GRAPH SECTION
// --------------------------------------------------------------------------------
function InfrastructureGraphSection() {
  return (
    <section id="infrastructure" className="py-32 px-6 w-full border-t border-white/5 bg-[#0A0A0A] relative z-10">
      <div className="max-w-7xl mx-auto flex flex-col items-center">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-20 text-center">The entire stack.<br/>In one platform.</h2>
        
        <div className="w-full max-w-4xl relative">
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-y-1/2"></div>
          
          <div className="flex flex-col md:flex-row justify-between items-center gap-10 md:gap-0 relative z-10">
            {[
              { label: "Code", icon: GitBranch, color: "bg-white/10" },
              { label: "Build", icon: Terminal, color: "bg-[#4F7CFF]/20 text-[#4F7CFF]" },
              { label: "Container", icon: Box, color: "bg-purple-500/20 text-purple-400" },
              { label: "Database", icon: Database, color: "bg-green-500/20 text-green-400" },
              { label: "Global Edge", icon: Globe, color: "bg-white text-black" }
            ].map((step, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ delay: i * 0.2 }}
                className="flex flex-col items-center gap-4"
              >
                <div className={`h-20 w-20 rounded-[16px] flex items-center justify-center border border-white/10 backdrop-blur-md shadow-xl ${step.color} relative group`}>
                  {i < 4 && <div className="hidden md:block absolute right-[-40%] top-1/2 -translate-y-1/2 w-4 h-0.5 bg-white/20 group-hover:bg-[#4F7CFF] transition-colors"></div>}
                  {i < 4 && <div className="hidden md:block absolute right-[-80%] top-1/2 -translate-y-1/2 w-4 h-0.5 bg-white/20 group-hover:bg-[#4F7CFF] transition-colors"></div>}
                  <step.icon className="h-8 w-8" />
                </div>
                <span className="font-medium text-sm text-white/80">{step.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------
// AI & ANALYTICS SECTION
// --------------------------------------------------------------------------------
function AIAndAnalyticsSection() {
  const mockData = Array.from({ length: 24 }).map((_, i) => ({ time: i, req: Math.random() * 1000 + 500 }));

  return (
    <section className="py-32 px-6 max-w-7xl mx-auto w-full relative z-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-8 md:p-12 overflow-hidden relative group">
          <h3 className="text-2xl font-bold mb-4">Deep Observability</h3>
          <p className="text-white/50 mb-10 max-w-sm">Monitor CPU, Memory, bandwidth, and edge requests with sub-second latency.</p>
          
          <div className="h-64 w-full relative z-10 border border-white/10 rounded-[16px] bg-[#0A0A0A] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockData}>
                <defs>
                  <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F7CFF" stopOpacity={0.5}/>
                    <stop offset="95%" stopColor="#4F7CFF" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <Area type="monotone" dataKey="req" stroke="#4F7CFF" strokeWidth={3} fillOpacity={1} fill="url(#colorReq)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-8 md:p-12 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 blur-[100px] rounded-full"></div>
          <h3 className="text-2xl font-bold mb-4">Meet Orb AI</h3>
          <p className="text-white/50 mb-8 max-w-sm">Your infrastructure engineer. Fixes builds, optimizes Dockerfiles, and scales databases autonomously.</p>
          
          <div className="rounded-[16px] border border-white/10 bg-[#0A0A0A] p-5 flex flex-col gap-4">
            <div className="flex gap-3 items-start">
              <div className="h-8 w-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 border border-red-500/20"><X className="h-4 w-4" /></div>
              <div className="bg-white/5 rounded-[12px] p-3 text-sm text-white/80 border border-white/10">Build failed: Cannot find module 'react'</div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="h-8 w-8 rounded-full bg-[#4F7CFF]/20 text-[#4F7CFF] flex items-center justify-center shrink-0 border border-[#4F7CFF]/20"><Bot className="h-4 w-4" /></div>
              <div className="bg-[#4F7CFF]/10 rounded-[12px] p-3 text-sm text-white border border-[#4F7CFF]/20">
                <p className="mb-2">I detected a missing dependency in your <span className="font-mono text-xs bg-black/50 px-1 rounded">package.json</span>.</p>
                <Button size="sm" className="h-7 text-xs bg-[#4F7CFF] text-white hover:bg-[#4F7CFF]/80">Apply Fix & Redeploy</Button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------
// PRICING SECTION
// --------------------------------------------------------------------------------
function PricingSection() {
  return (
    <section id="pricing" className="py-32 px-6 max-w-7xl mx-auto w-full relative z-10 border-t border-white/5">
      <div className="text-center mb-20 max-w-2xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Simple, transparent pricing</h2>
        <p className="text-lg text-white/50">Start for free, scale to billions of requests. No hidden fees.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          { name: "Hobby", price: "$0", desc: "For personal projects and experiments.", features: ["3 Projects", "100GB Bandwidth", "Community Support", "Shared Edge Network"] },
          { name: "Pro", price: "$20", desc: "For professionals and small teams.", features: ["Unlimited Projects", "1TB Bandwidth", "Email Support", "Dedicated Edge Nodes", "AI Build Assistant"], popular: true },
          { name: "Enterprise", price: "Custom", desc: "For scale-ups and large organizations.", features: ["Custom Limits", "99.99% SLA", "24/7 Phone Support", "VPC Peering", "Dedicated Account Manager"] },
        ].map((plan, i) => (
          <div key={i} className={`rounded-[24px] border ${plan.popular ? 'border-[#4F7CFF]' : 'border-white/10'} bg-[#0A0A0A] p-8 relative flex flex-col`}>
            {plan.popular && <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#4F7CFF] text-white text-[10px] font-bold uppercase tracking-widest py-1 px-3 rounded-full">Most Popular</div>}
            {plan.popular && <div className="absolute inset-0 bg-gradient-to-b from-[#4F7CFF]/5 to-transparent rounded-[24px] pointer-events-none"></div>}
            
            <h3 className="text-xl font-medium mb-2">{plan.name}</h3>
            <div className="mb-4"><span className="text-4xl font-bold">{plan.price}</span>{plan.price !== "Custom" && <span className="text-white/50">/mo</span>}</div>
            <p className="text-sm text-white/50 mb-8">{plan.desc}</p>
            
            <ul className="flex flex-col gap-4 mb-8 flex-1">
              {plan.features.map((f, j) => (
                <li key={j} className="flex items-center gap-3 text-sm text-white/80">
                  <CheckCircle2 className={`h-4 w-4 ${plan.popular ? 'text-[#4F7CFF]' : 'text-white/30'}`} /> {f}
                </li>
              ))}
            </ul>
            
            <Button className={`w-full h-12 rounded-[12px] font-medium ${plan.popular ? 'bg-[#4F7CFF] text-white hover:bg-[#4F7CFF]/90' : 'bg-white/5 hover:bg-white/10 text-white'}`}>
              {plan.price === "Custom" ? "Contact Sales" : "Get Started"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------
// FOOTER
// --------------------------------------------------------------------------------
function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#050505] pt-20 pb-10 px-6 relative z-10">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-10 mb-16">
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-6 h-6 rounded flex items-center justify-center overflow-hidden bg-[#0A0A0A]">
              <Image src="/logo.png" alt="Orb Logo" width={24} height={24} className="object-cover" />
            </div>
            <span className="font-semibold tracking-tight">Orb Platform</span>
          </div>
          <p className="text-white/50 text-sm max-w-xs">The intelligent cloud platform. Deploy and scale applications worldwide with zero configuration.</p>
        </div>
        
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold text-sm">Product</h4>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Features</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Pricing</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Enterprise</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Changelog</Link>
        </div>
        
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold text-sm">Resources</h4>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Documentation</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">API Reference</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Blog</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Community</Link>
        </div>
        
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold text-sm">Legal</h4>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Privacy Policy</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Terms of Service</Link>
          <Link href="#" className="text-sm text-white/50 hover:text-white transition-colors">Security</Link>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between pt-8 border-t border-white/10">
        <p className="text-xs text-white/40">© {new Date().getFullYear()} Orb Inc. All rights reserved.</p>
        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <GitBranch className="h-4 w-4 text-white/40 hover:text-white cursor-pointer transition-colors" />
          <Globe className="h-4 w-4 text-white/40 hover:text-white cursor-pointer transition-colors" />
        </div>
      </div>
    </footer>
  );
}
