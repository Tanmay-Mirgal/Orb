"use client";

import { Box, Activity, Globe, Cpu, GitBranch, ArrowUpRight, CheckCircle2, Link2, Zap, Settings2 } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";

export function DashboardContentClient({ projectsData, userName }: { projectsData: any[], userName?: string }) {
  const stats = [
    { title: "Projects", value: projectsData.length.toString(), icon: Box },
    { title: "Deployments", value: "24", icon: Activity },
    { title: "Last Deploy", value: "2m ago", icon: Zap }
  ];

  // Mock activity feed
  const activities = [
    { type: "deploy", text: "Deployment completed for orb-web", time: "2m ago", icon: CheckCircle2, color: "text-green-500" },
    { type: "domain", text: "Custom domain orb.dev connected", time: "1h ago", icon: Globe, color: "text-[#4F7CFF]" },
    { type: "repo", text: "Repository orb-platform connected", time: "3h ago", icon: Link2, color: "text-white/70" },
    { type: "env", text: "Environment variable DATABASE_URL updated", time: "5h ago", icon: Settings2, color: "text-purple-400" },
    { type: "worker", text: "Edge worker analytics-processor deployed", time: "1d ago", icon: Cpu, color: "text-orange-400" },
  ];

  return (
    <div className="flex flex-col gap-10">
      
      {/* Compact Hero */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            {userName ? `Welcome Back, ${userName.split(' ')[0]} 👋` : "Welcome Back 👋"}
          </h1>
          <p className="text-sm text-muted-foreground">Here is what's happening with your projects today.</p>
        </div>
        
        {/* Very Compact Stats */}
        <div className="flex items-center gap-6">
          {stats.map((stat, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wider font-medium">
                <stat.icon className="h-3 w-3" />
                {stat.title}
              </div>
              <span className="text-xl font-semibold text-white">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid: Projects & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left: Project List (Takes up 2 columns on large screens) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Your Projects</h2>
            <Button variant="outline" size="sm" className="h-7 text-xs bg-white/[0.02] border-white/10 text-white" asChild>
              <Link href="/dashboard/new">New Project</Link>
            </Button>
          </div>
          
          <div className="flex flex-col border border-white/10 rounded-[12px] bg-white/[0.02] overflow-hidden">
            {projectsData.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No projects yet. Get started by deploying a template or importing a repository.</div>
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
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-white hover:bg-white/5">
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Compact Activity Feed */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Recent Activity</h2>
          </div>
          
          <div className="border border-white/10 rounded-[12px] bg-white/[0.02] p-4 flex flex-col gap-5">
            {activities.map((activity, i) => (
              <div key={i} className="flex gap-3 items-start relative">
                {i !== activities.length - 1 && (
                  <div className="absolute top-6 left-2 bottom-[-20px] w-px bg-white/5"></div>
                )}
                <div className="relative z-10 h-4 w-4 rounded-full bg-[#0A0A0A] border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <activity.icon className={`h-2.5 w-2.5 ${activity.color}`} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-white/90 leading-snug">{activity.text}</span>
                  <span className="text-[10px] text-white/40">{activity.time}</span>
                </div>
              </div>
            ))}
            <Button variant="ghost" className="w-full h-8 mt-2 text-xs text-muted-foreground hover:text-white hover:bg-white/5">View All Activity</Button>
          </div>
        </div>

      </div>

    </div>
  );
}
