"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { User, LogOut } from "lucide-react";
import { useSession, signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SettingsContentClient() {
  const { data: session } = useSession();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="flex flex-col gap-8 pb-20 max-w-7xl mx-auto min-h-screen">
      <div className="flex flex-col gap-2 border-b border-border/40 pb-8">
        <h1 className="text-3xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your personal profile and account.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-12 items-start relative">
        {/* Left Sidebar Navigation (Sticky) */}
        <div className="w-full lg:w-64 flex-shrink-0 lg:sticky lg:top-24">
          <nav className="flex flex-col space-y-1">
            <button
              className="flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-sm font-medium transition-all relative text-foreground bg-secondary/50"
            >
              <User className="h-4 w-4" />
              Profile
              <motion.div
                layoutId="settings-nav-indicator"
                className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-foreground rounded-r-full"
              />
            </button>
          </nav>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 w-full max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-col gap-10">
              <div>
                <h2 className="text-xl font-semibold mb-6">Personal Profile</h2>
                <div className="rounded-[24px] border border-border/40 bg-card p-8 flex flex-col gap-8 shadow-sm">
                  
                  {/* Avatar Section */}
                  <div className="flex items-start gap-6 pb-8 border-b border-border/40">
                    <div className="h-20 w-20 rounded-full bg-accent/20 flex items-center justify-center border border-border shadow-inner flex-shrink-0 overflow-hidden">
                      {session?.user?.image ? (
                        <img src={session.user.image} alt={session.user.name || "User"} className="h-full w-full object-cover" />
                      ) : (
                        <span className="font-bold text-2xl text-accent">
                          {session?.user?.name?.charAt(0).toUpperCase() || "U"}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <h3 className="text-sm font-medium">Avatar</h3>
                        <p className="text-sm text-muted-foreground mt-1">Your avatar is synced with your GitHub account.</p>
                      </div>
                    </div>
                  </div>

                  {/* Profile Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium">Full Name</label>
                      <input 
                        type="text" 
                        value={session?.user?.name || ""} 
                        disabled 
                        className="h-10 bg-secondary/10 border border-border/50 rounded-lg px-3 text-sm opacity-60 cursor-not-allowed" 
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium">Email</label>
                      <input 
                        type="email" 
                        value={session?.user?.email || ""} 
                        disabled 
                        className="h-10 bg-secondary/10 border border-border/50 rounded-lg px-3 text-sm opacity-60 cursor-not-allowed" 
                      />
                    </div>
                  </div>
                  
                  <div className="pt-4 flex justify-end">
                    <Button variant="destructive" onClick={handleSignOut} className="flex items-center gap-2">
                      <LogOut className="h-4 w-4" /> Sign Out
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
