import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Bot, GitBranch, Globe, RefreshCcw, Server, Shield, Terminal, Zap } from "lucide-react";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* Background Animated Grid & Dots */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-primary opacity-5 blur-[100px]"></div>
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/40 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">O</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Orb</span>
        </div>
        <nav className="hidden md:flex gap-6 text-sm font-medium text-muted-foreground">
          <Link href="#features" className="hover:text-foreground transition-colors">Features</Link>
          <Link href="#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          <Link href="#docs" className="hover:text-foreground transition-colors">Documentation</Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Log In</Link>
          <Button asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 relative z-10 flex flex-col">
        {/* Hero Section */}
        <section className="px-6 pt-32 pb-24 text-center max-w-4xl mx-auto flex flex-col items-center">
          <div className="inline-flex items-center rounded-full border border-border px-3 py-1 text-sm font-medium mb-8 bg-secondary/50 backdrop-blur-md">
            <span className="flex h-2 w-2 rounded-full bg-success mr-2 animate-pulse"></span>
            Orb 2.0 is now live
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
            Deploy Anything.<br />Powered by AI.
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl leading-relaxed">
            Deploy full stack applications, Docker containers, APIs, AI models and static websites in seconds. Zero configuration required.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Button size="lg" className="h-12 px-8 text-base">
              Start Deploying <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-base">
              View Demo
            </Button>
          </div>
        </section>

        {/* Feature Section */}
        <section id="features" className="px-6 py-24 max-w-7xl mx-auto w-full">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Everything you need to scale</h2>
            <p className="text-muted-foreground">The most advanced deployment platform built for developers.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "AI Deployment", icon: Bot, desc: "Automatic configuration generation based on your codebase." },
              { title: "GitHub Integration", icon: GitBranch, desc: "Push to deploy. Automatic preview environments for every PR." },
              { title: "Realtime Logs", icon: Terminal, desc: "Stream logs from your containers instantly with our blazing fast UI." },
              { title: "Custom Domains", icon: Globe, desc: "Map your domains instantly with automatic SSL provisioning." },
              { title: "Zero Downtime", icon: RefreshCcw, desc: "Seamless rollouts ensure your app is always available." },
              { title: "Autoscaling", icon: Zap, desc: "Scale resources automatically based on traffic and demand." }
            ].map((feature, i) => (
              <Card key={i} className="bg-card/50 backdrop-blur-sm border-border/50 hover:border-border transition-all duration-300 group">
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <feature.icon className="h-6 w-6 text-foreground" />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">{feature.desc}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/40 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">O</span>
            </div>
            <span className="font-medium">Orb Inc.</span>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="#" className="hover:text-foreground">Documentation</Link>
            <Link href="#" className="hover:text-foreground">API</Link>
            <Link href="#" className="hover:text-foreground">Privacy</Link>
            <Link href="#" className="hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
