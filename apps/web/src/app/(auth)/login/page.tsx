"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranch, Box } from "lucide-react";
import { motion } from "framer-motion";

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
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative blurred blob */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="h-12 w-12 rounded-xl bg-foreground flex items-center justify-center shadow-lg mb-6">
            <Box className="h-6 w-6 text-background" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome to Orb</h1>
          <p className="text-muted-foreground mt-2">Sign in to deploy your next big idea.</p>
        </div>

        <Card className="border-border/50 shadow-2xl bg-card/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-center">Authentication</CardTitle>
            <CardDescription className="text-center">
              Connect your GitHub account to import repositories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full h-11 text-base font-medium flex items-center gap-3 transition-all hover:bg-foreground hover:text-background" 
              onClick={handleGitHubLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="h-5 w-5 rounded-full border-2 border-background border-t-transparent animate-spin" />
              ) : (
                <GitBranch className="h-5 w-5" />
              )}
              {isLoading ? "Redirecting..." : "Continue with GitHub"}
            </Button>
            
            <p className="text-xs text-center text-muted-foreground mt-6 leading-relaxed">
              By continuing, you agree to our Terms of Service and Privacy Policy.
              We will request access to your public and private repositories.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
