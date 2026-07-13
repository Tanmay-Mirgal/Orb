"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { GitBranch, Shield, ArrowRight, Building, Box, Zap, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const handleGitHubLogin = async () => {
    setIsLoading("github");
    try {
      await signIn.social({
        provider: "github",
        callbackURL: "/dashboard"
      });
    } catch (e) {
      console.error(e);
      setIsLoading(null);
    }
  };

  const handleMockLogin = (provider: string) => {
    setIsLoading(provider);
    setTimeout(() => {
      setIsLoading(null);
    }, 1500);
  };

  return (
    <div className="min-h-screen w-full flex bg-[#050505] text-white selection:bg-accent/30 selection:text-white">
      
      {/* =========================================
          LEFT SIDE: VISUAL & INFRASTRUCTURE
          ========================================= */}
      <div className="hidden lg:flex w-1/2 relative flex-col items-center justify-center overflow-hidden border-r border-white/5 bg-[#020202]">
        
        {/* Animated Grid & Glows */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px]"></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full bg-[#4F7CFF] opacity-[0.03] blur-[100px]"></div>
          <div className="absolute top-1/4 left-1/4 h-[400px] w-[400px] rounded-full bg-purple-600 opacity-[0.03] blur-[100px]"></div>
        </div>

        {/* Abstract World Map Simulation */}
        <div className="relative z-10 w-full max-w-lg h-[400px] flex items-center justify-center opacity-40 mix-blend-screen">
          <svg viewBox="0 0 800 400" className="w-full h-full">
            <path d="M 100 200 Q 200 50, 400 200 T 700 200" fill="none" stroke="url(#gradient)" strokeWidth="1" strokeDasharray="4 4" />
            <path d="M 150 250 Q 300 100, 500 250 T 750 200" fill="none" stroke="url(#gradient)" strokeWidth="0.5" strokeDasharray="2 6" />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4F7CFF" stopOpacity="0" />
                <stop offset="50%" stopColor="#4F7CFF" stopOpacity="1" />
                <stop offset="100%" stopColor="#4F7CFF" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Floating Metrics */}
        <div className="absolute z-20 inset-0 pointer-events-none">
          <motion.div 
            animate={{ y: [0, -15, 0] }} transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
            className="absolute top-[25%] left-[20%] rounded-[16px] border border-white/10 bg-[#0A0A0A]/80 backdrop-blur-md p-4 flex items-center gap-4 shadow-2xl"
          >
            <div className="h-10 w-10 rounded-[10px] bg-[#4F7CFF]/20 flex items-center justify-center border border-[#4F7CFF]/30">
              <Activity className="h-5 w-5 text-[#4F7CFF]" />
            </div>
            <div>
              <div className="text-xs text-white/50 mb-0.5">Active Deployments</div>
              <div className="text-xl font-bold font-mono text-white/90">24,592</div>
            </div>
          </motion.div>

          <motion.div 
            animate={{ y: [0, 15, 0] }} transition={{ repeat: Infinity, duration: 5, ease: "easeInOut", delay: 1 }}
            className="absolute top-[60%] right-[15%] rounded-[16px] border border-white/10 bg-[#0A0A0A]/80 backdrop-blur-md p-4 flex items-center gap-4 shadow-2xl"
          >
            <div className="h-10 w-10 rounded-[10px] bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
              <Zap className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <div className="text-xs text-white/50 mb-0.5">Edge Requests/s</div>
              <div className="text-xl font-bold font-mono text-white/90">1.2M</div>
            </div>
          </motion.div>

          <motion.div 
            animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 2 }}
            className="absolute bottom-[20%] left-[30%] rounded-[16px] border border-white/10 bg-[#0A0A0A]/80 backdrop-blur-md p-3 flex items-center gap-3 shadow-2xl"
          >
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]"></div>
            <div className="text-sm font-medium text-white/80">IAD1 Node Online</div>
          </motion.div>
        </div>

      </div>

      {/* =========================================
          RIGHT SIDE: AUTHENTICATION PANEL
          ========================================= */}
      <div className="w-full lg:w-1/2 relative flex flex-col items-center justify-center p-8 lg:p-24 z-10">
        
        {/* Subtle right-side background glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#4F7CFF]/5 blur-[150px] pointer-events-none rounded-full"></div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="w-full max-w-[420px] flex flex-col items-center"
        >
          {/* Logo & Header */}
          <div className="flex flex-col items-center text-center mb-10 w-full">
            <div className="w-12 h-12 rounded-[12px] bg-white flex items-center justify-center border border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.2)] mb-8">
              <span className="text-black font-extrabold text-2xl">O</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome Back</h1>
            <p className="text-white/50 text-base">Deploy with confidence. Scale with ease.</p>
          </div>

          {/* Glassmorphism Auth Card */}
          <div className="w-full rounded-[24px] border border-white/10 bg-white/[0.02] backdrop-blur-2xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
            
            <div className="flex flex-col gap-4">
              
              {/* GitHub Auth (Functional) */}
              <Button 
                onClick={handleGitHubLogin}
                disabled={isLoading !== null}
                className="w-full h-14 bg-white hover:bg-white/90 text-black rounded-[12px] font-medium text-base transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-between px-6 group"
              >
                <div className="flex items-center gap-3">
                  <GitBranch className="h-5 w-5" />
                  Continue with GitHub
                </div>
                {isLoading === "github" ? (
                  <div className="h-5 w-5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                )}
              </Button>

              <div className="relative py-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                <div className="relative bg-[#050505] px-4 text-xs uppercase tracking-widest text-white/30 font-medium">Or</div>
              </div>

              {/* GitLab (Mock) */}
              <Button 
                onClick={() => handleMockLogin("gitlab")}
                disabled={isLoading !== null}
                variant="outline"
                className="w-full h-14 bg-transparent hover:bg-white/[0.04] border-white/10 text-white rounded-[12px] font-medium text-base transition-all flex items-center justify-center gap-3 relative overflow-hidden group"
              >
                {isLoading === "gitlab" ? (
                  <div className="h-5 w-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                ) : (
                  <>
                    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 5.11 2a.43.43 0 0 1 .4.27l2.45 7.51h8.08l2.45-7.51A.43.43 0 0 1 18.89 2a.42.42 0 0 1 .4.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.94z"/></svg>
                    Continue with GitLab
                  </>
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-[100%] group-hover:animate-[shimmer_1.5s_infinite]"></div>
              </Button>

              {/* Google (Mock) */}
              <Button 
                onClick={() => handleMockLogin("google")}
                disabled={isLoading !== null}
                variant="outline"
                className="w-full h-14 bg-transparent hover:bg-white/[0.04] border-white/10 text-white rounded-[12px] font-medium text-base transition-all flex items-center justify-center gap-3"
              >
                {isLoading === "google" ? (
                  <div className="h-5 w-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                ) : (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/><path fill="none" d="M1 1h22v22H1z"/></svg>
                    Continue with Google
                  </>
                )}
              </Button>

              {/* Enterprise SSO (Mock) */}
              <Button 
                onClick={() => handleMockLogin("sso")}
                disabled={isLoading !== null}
                variant="ghost"
                className="w-full h-14 hover:bg-white/[0.04] text-white/70 hover:text-white rounded-[12px] font-medium text-sm transition-all flex items-center justify-center gap-2 mt-2"
              >
                {isLoading === "sso" ? (
                  <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                ) : (
                  <>
                    <Building className="h-4 w-4" />
                    Enterprise SSO
                  </>
                )}
              </Button>

            </div>
          </div>

          {/* Security Badges */}
          <div className="w-full flex items-center justify-between px-2 mt-8 text-[11px] font-medium text-white/40 uppercase tracking-wider">
            <div className="flex items-center gap-1.5"><Shield className="h-3 w-3" /> End-to-end encrypted</div>
            <div className="flex items-center gap-1.5"><Box className="h-3 w-3" /> GitHub Verified</div>
          </div>

        </motion.div>

        {/* Footer Links */}
        <div className="absolute bottom-8 flex items-center gap-6 text-xs text-white/40 font-medium z-10">
          <Link href="#" className="hover:text-white transition-colors">Privacy</Link>
          <span className="w-1 h-1 rounded-full bg-white/20"></span>
          <Link href="#" className="hover:text-white transition-colors">Terms</Link>
          <span className="w-1 h-1 rounded-full bg-white/20"></span>
          <Link href="#" className="hover:text-white transition-colors">Documentation</Link>
          <span className="w-1 h-1 rounded-full bg-white/20"></span>
          <Link href="#" className="hover:text-white transition-colors flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500"></span> Status
          </Link>
        </div>

      </div>
    </div>
  );
}
