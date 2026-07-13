"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  Activity, Box, CreditCard, Database, Globe, 
  LayoutDashboard, Plus, Search, Settings, Webhook, 
  PanelLeftClose, PanelLeftOpen, Bell
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

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
        <div
          className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
            isActive 
              ? "bg-secondary/40 text-foreground border border-border/40" 
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/20 border border-transparent"
          }`}
        >
          <item.icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`} />
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
        </div>
      </Link>
    );
  };

  const NavSection = ({ title, items }: { title: string, items: NavItem[] }) => (
    <div className="flex flex-col gap-0.5 mb-6">
      {!isCollapsed && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest mb-2 px-3"
        >
          {title}
        </motion.div>
      )}
      {items.map(item => <NavLink key={item.name} item={item} />)}
    </div>
  );

  return (
    <div className="flex h-screen bg-[#050505] overflow-hidden text-white font-sans selection:bg-accent/30">
      {/* Sidebar - Clean, Minimal */}
      <motion.aside 
        animate={{ width: isCollapsed ? 64 : 240 }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
        className="h-full flex-shrink-0 flex flex-col hidden md:flex border-r border-white/5 bg-[#0A0A0A] relative z-20"
      >
        {/* Logo Area */}
        <div className="h-14 flex items-center px-4 border-b border-white/5 shrink-0">
          <Link href="/dashboard" className="flex items-center gap-3 w-full">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-white text-black font-bold text-xs shrink-0">
              O
            </div>
            {!isCollapsed && (
              <motion.span 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="font-semibold tracking-tight text-sm"
              >
                Orb
              </motion.span>
            )}
          </Link>
        </div>
        
        {/* Nav Links */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-6 px-3 custom-scrollbar">
          <NavSection title="General" items={GENERAL_NAV} />
          <NavSection title="Resources" items={RESOURCES_NAV} />
          <NavSection title="Account" items={ACCOUNT_NAV} />
        </div>

        {/* Footer Area */}
        <div className="shrink-0 p-3 border-t border-white/5 flex items-center justify-between">
          <div className="flex-1 truncate">
            {!isCollapsed && userProfile}
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-muted-foreground hover:text-white h-7 w-7 shrink-0 rounded-md"
          >
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 relative bg-[#050505]">
        
        {/* Minimal Topbar */}
        <header className="h-14 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md flex items-center justify-between px-6 absolute top-0 w-full z-10">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-[280px] hidden sm:flex items-center group">
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground group-focus-within:text-white transition-colors" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full h-8 bg-white/5 border border-white/10 rounded-md pl-9 pr-10 text-[13px] text-white focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder:text-muted-foreground"
              />
              <div className="absolute right-2 flex items-center">
                <kbd className="inline-flex items-center rounded border border-white/10 bg-white/5 px-1.5 font-mono text-[10px] text-muted-foreground">
                  ⌘K
                </kbd>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-muted-foreground hover:text-white relative">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500"></span>
            </button>
            <div className="h-4 w-px bg-white/10"></div>
            <Link href="/dashboard/new">
              <button className="h-8 px-3 rounded-md bg-white text-black text-[13px] font-medium hover:bg-white/90 transition-colors flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </Link>
          </div>
        </header>
        
        {/* Page Content */}
        <div className="flex-1 overflow-auto pt-14">
          <div className="max-w-[1200px] mx-auto w-full p-8 md:p-10">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
