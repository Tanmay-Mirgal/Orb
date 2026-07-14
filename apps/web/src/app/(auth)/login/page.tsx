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
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090b] text-white relative overflow-hidden">

      {/* Subtle background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.06) 0%, transparent 70%)",
        }}
      />

      {/* Center card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 flex flex-col items-center text-center w-full max-w-[420px] px-8"
      >
        {/* Logo */}
        <div className="mb-8">
          <Image src="/logo.png" alt="Orb" width={64} height={64} className="rounded-2xl mx-auto shadow-[0_0_40px_rgba(99,102,241,0.2)]" />
        </div>

        {/* Heading */}
        <h1 className="text-[32px] font-black tracking-tight text-white mb-3 leading-tight">
          Welcome to Orb
        </h1>
        <p className="text-[15px] text-zinc-500 mb-10 leading-relaxed">
          Sign in to start deploying your projects<br />on your own infrastructure.
        </p>

        {/* GitHub button */}
        <Button
          onClick={handleGitHubLogin}
          disabled={isLoading}
          className="w-full h-[52px] bg-white hover:bg-zinc-100 text-black rounded-full font-semibold text-[15px] transition-colors flex items-center justify-center gap-2.5 shadow-[0_2px_20px_rgba(255,255,255,0.08)]"
        >
          {isLoading ? (
            <div className="h-4 w-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
          ) : (
            <>
              <GithubIcon className="h-5 w-5" />
              Continue with GitHub
            </>
          )}
        </Button>

        <p className="mt-8 text-[12px] text-zinc-700 leading-relaxed">
          By continuing, you agree to our{" "}
          <Link href="#" className="text-zinc-500 underline underline-offset-2 hover:text-zinc-300 transition-colors">Terms</Link>
          {" "}and{" "}
          <Link href="#" className="text-zinc-500 underline underline-offset-2 hover:text-zinc-300 transition-colors">Privacy Policy</Link>.
        </p>
      </motion.div>
    </div>
  );
}
