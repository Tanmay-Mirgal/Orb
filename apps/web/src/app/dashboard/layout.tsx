import { Button } from "@/components/ui/button";
import { Activity, Bell, Box, CreditCard, Database, Globe, LayoutDashboard, Plus, Search, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import { UserProfile } from "@/components/UserProfile";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border/40 bg-secondary/30 flex-shrink-0 flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-border/40">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">O</span>
            </div>
            <span className="font-semibold tracking-tight">Orb Workspace</span>
          </Link>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground mb-2 px-2">General</div>
          <NavLink href="/dashboard" icon={LayoutDashboard}>Overview</NavLink>
          <NavLink href="/dashboard/projects" icon={Box}>Projects</NavLink>
          <NavLink href="/dashboard/deployments" icon={Activity}>Deployments</NavLink>
          
          <div className="text-xs font-medium text-muted-foreground mt-6 mb-2 px-2">Resources</div>
          <NavLink href="/dashboard/domains" icon={Globe}>Domains</NavLink>
          <NavLink href="/dashboard/storage" icon={Database}>Storage</NavLink>
          <NavLink href="/dashboard/workers" icon={Webhook}>Workers</NavLink>
          
          <div className="text-xs font-medium text-muted-foreground mt-6 mb-2 px-2">Account</div>
          <NavLink href="/dashboard/billing" icon={CreditCard}>Billing</NavLink>
          <NavLink href="/dashboard/settings" icon={Settings}>Settings</NavLink>
        </div>

        <div className="p-4 border-t border-border/40">
          <UserProfile />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="h-16 border-b border-border/40 bg-background flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md hidden sm:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search projects, domains..."
                className="w-full h-9 bg-secondary/50 border border-border/50 rounded-md pl-9 pr-4 text-sm focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-muted-foreground rounded-full h-9 w-9">
              <Bell className="h-4 w-4" />
            </Button>
            <Link href="/dashboard/new">
              <Button size="sm" className="h-9">
                <Plus className="mr-2 h-4 w-4" /> New Project
              </Button>
            </Link>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6 md:p-8">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavLink({ href, icon: Icon, children }: { href: string; icon: any; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}
