"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  Activity, Bell, Box, CreditCard, Database, Globe, 
  LayoutDashboard, Plus, Search, Settings, Webhook, 
  PanelLeftClose, PanelLeftOpen, Lock, Terminal, BarChart, Moon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

interface NavItem {
  name: string;
  href: string;
  icon: any;
}

const GENERAL_NAV: NavItem[] = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Projects", href: "/dashboard/projects", icon: Box },
  { name: "Deployments", href: "/dashboard/deployments", icon: Activity },
];

const RESOURCES_NAV: NavItem[] = [
  { name: "Domains", href: "/dashboard/domains", icon: Globe },
  { name: "Storage", href: "/dashboard/storage", icon: Database },
  { name: "Workers", href: "/dashboard/workers", icon: Webhook },
  { name: "Secrets", href: "/dashboard/secrets", icon: Lock },
  { name: "Logs", href: "/dashboard/logs", icon: Terminal },
  { name: "Analytics", href: "/dashboard/analytics", icon: BarChart },
];

const ACCOUNT_NAV: NavItem[] = [
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function SidebarLayout({ 
  children, 
  userProfile 
}: { 
  children: React.ReactNode;
  userProfile: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
    
    return (
      <Link href={item.href}>
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            isActive 
              ? "bg-secondary/50 text-foreground shadow-sm border border-border/50" 
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 border border-transparent"
          }`}
        >
          <item.icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? "text-accent" : ""}`} />
          <AnimatePresence>
            {!isCollapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="whitespace-nowrap overflow-hidden"
              >
                {item.name}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </Link>
    );
  };

  const NavSection = ({ title, items }: { title: string, items: NavItem[] }) => (
    <div className="flex flex-col gap-1 mb-6">
      {!isCollapsed && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3"
        >
          {title}
        </motion.div>
      )}
      {items.map(item => <NavLink key={item.name} item={item} />)}
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Floating Sidebar */}
      <motion.aside 
        animate={{ width: isCollapsed ? 72 : 260 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="h-full flex-shrink-0 flex flex-col hidden md:flex border-r border-border/40 bg-card/30 backdrop-blur-xl relative z-20 shadow-[4px_0_24px_rgba(0,0,0,0.2)]"
      >
        <div className="h-16 flex items-center px-5 border-b border-border/40 shrink-0">
          <Link href="/dashboard" className="flex items-center gap-3 w-full">
            <div className="relative w-7 h-7 shrink-0">
              <Image src="/logo.png" alt="Orb" fill className="object-contain" />
            </div>
            {!isCollapsed && (
              <motion.span 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="font-bold tracking-tight text-lg"
              >
                Orb
              </motion.span>
            )}
          </Link>
        </div>
        
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-6 px-3 custom-scrollbar">
          <NavSection title="General" items={GENERAL_NAV} />
          <NavSection title="Resources" items={RESOURCES_NAV} />
          <NavSection title="Account" items={ACCOUNT_NAV} />
        </div>

        <div className="shrink-0 p-3 border-t border-border/40 flex flex-col gap-2">
          {!isCollapsed && userProfile}
          
          <div className="flex items-center justify-between gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-muted-foreground hover:text-foreground h-9 w-9 shrink-0"
            >
              {isCollapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </Button>
            
            {!isCollapsed && (
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-9 w-9 shrink-0">
                <Moon className="h-[18px] w-[18px]" />
              </Button>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Blurred Topbar */}
        <header className="h-16 border-b border-border/40 bg-background/60 backdrop-blur-xl flex items-center justify-between px-8 absolute top-0 w-full z-10 supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md hidden sm:flex items-center group">
              <Search className="absolute left-3 h-[18px] w-[18px] text-muted-foreground group-focus-within:text-accent transition-colors" />
              <input
                type="text"
                placeholder="Search projects, domains..."
                className="w-full h-10 bg-card border border-border/50 rounded-lg pl-10 pr-12 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all shadow-sm"
              />
              <div className="absolute right-3 flex items-center gap-1">
                <kbd className="inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground rounded-full h-9 w-9 relative">
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent ring-2 ring-background"></span>
            </Button>
            
            <div className="h-5 w-px bg-border/60 mx-1"></div>
            
            <Link href="/dashboard/new">
              <Button size="sm" className="h-9 px-4 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground shadow-[0_0_15px_rgba(79,124,255,0.3)] transition-all">
                <Plus className="mr-2 h-4 w-4" /> New Project
              </Button>
            </Link>
          </div>
        </header>
        
        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-auto pt-16">
          <div className="max-w-[1400px] mx-auto w-full p-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {children}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
