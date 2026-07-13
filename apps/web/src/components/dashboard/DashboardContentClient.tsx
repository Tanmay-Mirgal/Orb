"use client";

import { Box, Activity, Globe, Cpu, GitBranch, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { DashboardCharts } from "@/features/dashboard/components/DashboardCharts";

export function DashboardContentClient({ projectsData, userName }: { projectsData: any[], userName?: string }) {
  const stats = [
    { title: "Projects", value: projectsData.length.toString(), icon: Box, trend: "Active" },
    { title: "Deployments", value: "24", icon: Activity, trend: "Healthy" },
    { title: "Domains", value: projectsData.length.toString(), icon: Globe, trend: "Secured" },
    { title: "Workers", value: "3", icon: Cpu, trend: "Running" }
  ];

  return (
    <div className="flex flex-col gap-10">
      
      {/* Very Minimal Hero */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Overview</h1>
        <p className="text-sm text-muted-foreground">Monitor your infrastructure and recent activity.</p>
      </div>

      {/* Compact Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="flex flex-col gap-2 p-4 rounded-[16px] border border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium uppercase tracking-wider">{stat.title}</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-semibold text-white">{stat.value}</span>
              <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded font-medium">{stat.trend}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid: Projects & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left: Recent Projects */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Recent Projects</h2>
            <Link href="/dashboard/projects" className="text-xs text-muted-foreground hover:text-white transition-colors">
              View All
            </Link>
          </div>
          
          <div className="flex flex-col border border-white/10 rounded-[16px] bg-white/[0.02] overflow-hidden">
            {projectsData.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No projects yet.</div>
            ) : (
              projectsData.map((data, i) => (
                <div key={i} className={`flex items-center justify-between p-3.5 hover:bg-white/[0.02] transition-colors ${i !== projectsData.length - 1 ? 'border-b border-white/5' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-full bg-[#050505] border border-white/10 flex items-center justify-center shrink-0">
                      <span className="font-semibold text-xs text-white">{data.project.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex flex-col">
                      <Link href={`/dashboard/projects/${data.project.slug || data.project.name.toLowerCase()}`} className="text-sm font-medium text-white hover:underline decoration-white/30 underline-offset-4">
                        {data.project.name}
                      </Link>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> main</span>
                        <span>•</span>
                        <span>{formatDistanceToNow(new Date(data.project.createdAt))} ago</span>
                        <span>•</span>
                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/70 border border-white/5">{data.project.framework || 'Next.js'}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-xs font-medium">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></div> Ready
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-white hover:bg-white/5" asChild>
                        <Link href={`/dashboard/projects/${data.project.slug || data.project.name.toLowerCase()}`}>Deploy</Link>
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-white hover:bg-white/5" asChild>
                        <a href={`https://${data.project.slug || data.project.name.toLowerCase()}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`} target="_blank" rel="noopener noreferrer">
                          <ArrowUpRight className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Deployment Timeline */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between opacity-0"> {/* Hide original title since DashboardCharts has its own */}
            <h2 className="text-sm font-medium text-white">Deployment Activity</h2>
          </div>
          <div className="border border-white/10 rounded-[16px] bg-white/[0.02] p-6 h-[300px]">
             <DashboardCharts />
          </div>
        </div>

      </div>

    </div>
  );
}
