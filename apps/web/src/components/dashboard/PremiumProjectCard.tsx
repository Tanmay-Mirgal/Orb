"use client";

import { motion } from "framer-motion";
import { 
  GitBranch, Globe, Play, Activity, Cpu, HardDrive, 
  Terminal, Settings, ExternalLink, MoreHorizontal,
  Box, Code
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";

interface PremiumProjectCardProps {
  project: any;
  repository: any;
  delay?: number;
}

const MiniSparkline = () => {
  // Simulated sparkline data points
  const points = "0,20 10,18 20,25 30,15 40,30 50,28 60,35 70,20 80,40 90,38 100,50";
  return (
    <svg viewBox="0 0 100 50" className="w-full h-8 stroke-accent fill-accent/10 opacity-70 group-hover:opacity-100 transition-opacity">
      <polyline points={points} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,50 ${points} 100,50`} stroke="none" />
    </svg>
  );
};

export function PremiumProjectCard({ project, repository, delay = 0 }: PremiumProjectCardProps) {
  const [imageError, setImageError] = useState(false);
  const isProd = true;
  const isGithubConnected = !!repository?.githubRepositoryName;
  const projectUrl = `https://${project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`;
  
  // Using DuckDuckGo's favicon service as it's more reliable and fails properly when no favicon exists
  const faviconUrl = `https://icons.duckduckgo.com/ip3/${project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}.ico`;

  const renderFallbackIcon = () => {
    const fw = (project.framework || "").toLowerCase();
    if (fw.includes("next")) {
      return (
        <svg viewBox="0 0 180 180" className="h-6 w-6 fill-white">
          <path d="M90 0C40.2944 0 0 40.2944 0 90C0 139.706 40.2944 180 90 180C139.706 180 180 139.706 180 90C180 40.2944 139.706 0 90 0ZM74.8727 122.973L57.5144 98.7842V58.3308H69.4147V91.6888L84.8115 113.144L74.8727 122.973ZM128.89 122.067H115.114V58.3308H128.89V122.067ZM88.0864 125.867L99.7042 142.062V58.3308H111.604V151.782L96.2078 130.326L88.0864 125.867Z"/>
        </svg>
      );
    }
    if (fw.includes("react")) {
      return (
        <svg viewBox="-11.5 -10.23174 23 20.46348" className="h-6 w-6 text-[#61DAFB]">
          <circle cx="0" cy="0" r="2.05" fill="currentColor"/>
          <g stroke="currentColor" strokeWidth="1" fill="none">
            <ellipse rx="11" ry="4.2"/>
            <ellipse rx="11" ry="4.2" transform="rotate(60)"/>
            <ellipse rx="11" ry="4.2" transform="rotate(120)"/>
          </g>
        </svg>
      );
    }
    if (fw.includes("node")) {
      return <Cpu className="h-6 w-6 text-[#339933]" />;
    }
    return <Box className="h-6 w-6 text-muted-foreground" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -4 }}
      className="group relative flex flex-col rounded-[24px] border border-border/40 bg-card p-6 transition-all duration-300 hover:border-accent/40 hover:shadow-[0_8px_30px_rgb(0,0,0,0.4)]"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-[24px] pointer-events-none"></div>
      
      {/* Top Header */}
      <div className="flex justify-between items-start mb-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 rounded-xl bg-secondary flex items-center justify-center border border-border/50 group-hover:border-accent/30 transition-colors overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none"></div>
            {!imageError ? (
              <img 
                src={faviconUrl} 
                alt={`${project.name} icon`}
                className="h-8 w-8 object-contain"
                onError={() => setImageError(true)}
              />
            ) : renderFallbackIcon()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/projects/${project.slug || project.name.toLowerCase()}`} className="text-xl font-semibold hover:text-accent transition-colors truncate">
                {project.name}
              </Link>
              <div className="px-2 py-0.5 rounded-full bg-secondary text-xs font-medium border border-border/50 text-muted-foreground shrink-0">
                {project.framework || 'Node.js'}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5 whitespace-nowrap">
              <span className="flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success"></span>
                </span>
                Production
              </span>
              {isGithubConnected && (
                <>
                  <span className="h-1 w-1 rounded-full bg-border shrink-0"></span>
                  <span className="flex items-center gap-1 truncate"><Code className="h-3 w-3 shrink-0" /> Connected</span>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Quick Actions / Dropdown */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" asChild>
            <a href={projectUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
          </Button>
        </div>
      </div>

      {/* Middle Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Repository</span>
          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{repository?.githubRepositoryName || 'local-repo'}</span>
            <span className="text-muted-foreground px-1.5 py-0.5 bg-secondary rounded text-[10px] shrink-0">{repository?.branch || 'main'}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Deployment</span>
          <div className="flex items-center gap-2 text-sm">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="truncate text-muted-foreground hover:text-foreground hover:underline transition-colors">
              {project.name}.orb.dev
            </a>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-border/40 mb-5 relative z-10"></div>

      {/* Bottom Simulated Metrics - Fixed Width/Wrapping */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground relative z-10">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Activity className="h-3.5 w-3.5 shrink-0" /> 
          Deployed {formatDistanceToNow(new Date(project.createdAt))} ago
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1"><Cpu className="h-3.5 w-3.5 text-white/40" /> 12%</span>
          <span className="flex items-center gap-1"><HardDrive className="h-3.5 w-3.5 text-white/40" /> 240MB</span>
        </span>
      </div>
    </motion.div>
  );
}
