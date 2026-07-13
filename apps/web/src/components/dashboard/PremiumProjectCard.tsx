"use client";

import { motion } from "framer-motion";
import { 
  GitBranch, Globe, Play, Activity, Cpu, HardDrive, 
  Terminal, Settings, ExternalLink, MoreHorizontal,
  Box, Code
} from "lucide-react";
import Link from "next/link";
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
  const isProd = true;
  const isGithubConnected = !!repository?.githubRepositoryName;
  const projectUrl = `https://${project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`;

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
            <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <span className="font-bold text-lg">{project.name.charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/projects/${project.name}`} className="text-xl font-semibold hover:text-accent transition-colors truncate">
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
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" asChild>
            <Link href={`/dashboard/projects/${project.name}/settings`}><Settings className="h-4 w-4" /></Link>
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
