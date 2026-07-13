"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
// Using standard simple SVG path for official GitHub logo to match brand guidelines perfectly
const GithubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    try {
      await signIn.social({
        provider: "github",
        callbackURL: "/dashboard"
      });
    } catch (e) {
      console.error(e);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#050505] text-white selection:bg-white/20 selection:text-white">
      
      {/* =========================================
          LEFT SIDE: SUBTLE INFRASTRUCTURE VISUAL
          ========================================= */}
      <div className="hidden lg:flex w-1/2 relative flex-col items-center justify-center overflow-hidden border-r border-white/5 bg-[#020202]">
        
        {/* Very subtle Animated Grid */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:48px_48px]"></div>
          {/* Subtle slow moving glow */}
          <motion.div 
            animate={{ 
              opacity: [0.01, 0.03, 0.01],
              scale: [1, 1.1, 1]
            }} 
            transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full bg-white blur-[120px]"
          />
        </div>

        {/* Minimal Abstract Node Network */}
        <div className="relative z-10 w-full max-w-lg h-[400px] flex items-center justify-center opacity-20 mix-blend-screen pointer-events-none">
          <svg viewBox="0 0 800 400" className="w-full h-full">
            <path d="M 100 200 L 400 200 L 700 200" fill="none" stroke="url(#gradient)" strokeWidth="0.5" strokeDasharray="4 4" />
            <path d="M 250 100 L 400 200 L 550 300" fill="none" stroke="url(#gradient)" strokeWidth="0.5" strokeDasharray="2 6" />
            <circle cx="400" cy="200" r="4" fill="#ffffff" opacity="0.5" />
            <circle cx="100" cy="200" r="3" fill="#ffffff" opacity="0.3" />
            <circle cx="700" cy="200" r="3" fill="#ffffff" opacity="0.3" />
            <circle cx="250" cy="100" r="2" fill="#ffffff" opacity="0.2" />
            <circle cx="550" cy="300" r="2" fill="#ffffff" opacity="0.2" />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

      </div>

      {/* =========================================
          RIGHT SIDE: ELEGANT AUTHENTICATION
          ========================================= */}
      <div className="w-full lg:w-1/2 relative flex flex-col items-center justify-center p-8 lg:p-24 z-10">
        
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="w-full max-w-[360px] flex flex-col items-center"
        >
          {/* Logo & Header */}
          <div className="flex flex-col items-center text-center mb-10 w-full">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-6 overflow-hidden bg-[#0A0A0A]">
              <Image src="/logo.png" alt="Orb Logo" width={40} height={40} className="object-cover" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">Welcome Back</h1>
            <p className="text-muted-foreground text-sm">Deploy with confidence. Scale with ease.</p>
          </div>

          {/* Minimal Auth Container */}
          <div className="w-full flex flex-col gap-4">
            
            {/* Primary CTA: Official GitHub Login */}
            <Button 
              onClick={handleGitHubLogin}
              disabled={isLoading}
              className="w-full h-11 bg-white hover:bg-gray-100 text-black rounded-md font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <div className="h-4 w-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
              ) : (
                <>
                  <GithubIcon className="h-4 w-4" />
                  Continue with GitHub
                </>
              )}
            </Button>

          </div>

        </motion.div>

        {/* Footer Links */}
        <div className="absolute bottom-8 flex items-center gap-4 text-[11px] text-muted-foreground font-medium z-10">
          <Link href="#" className="hover:text-white transition-colors">Privacy Policy</Link>
          <span className="w-0.5 h-0.5 rounded-full bg-white/20"></span>
          <Link href="#" className="hover:text-white transition-colors">Terms of Service</Link>
        </div>

      </div>
    </div>
  );
}
