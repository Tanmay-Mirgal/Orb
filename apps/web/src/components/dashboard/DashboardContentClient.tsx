"use client";

import { GitBranch, ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function DashboardContentClient({ projectsData, userName }: { projectsData: any[], userName?: string }) {
  const connectedRepos = projectsData.filter((d) => d.repository?.githubRepositoryName).length;
  
  const stats = [
    { title: "Total Projects", value: projectsData.length.toString() },
    { title: "Connected Repos", value: connectedRepos.toString() },
    { title: "Live Domains", value: projectsData.length.toString() },
  ];

  // Show up to 4 most recent projects
  const recentProjects = projectsData.slice(0, 4);

  return (
    <div className="flex flex-col gap-8 pb-20 max-w-6xl mx-auto">
      
      {/* Clean Professional Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your projects, repositories, and active deployments.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="h-9 rounded-md bg-secondary/20" asChild>
            <Link href="/dashboard/projects">View Projects</Link>
          </Button>
          <Button className="h-9 rounded-md" asChild>
            <Link href="/dashboard/new"><Plus className="w-4 h-4 mr-2" /> New Project</Link>
          </Button>
        </div>
      </div>

      {/* Minimal Standard Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="flex flex-col gap-1.5 p-5 rounded-xl border border-border/50 bg-card shadow-sm">
            <span className="text-sm font-medium text-muted-foreground">{stat.title}</span>
            <span className="text-3xl font-semibold text-foreground tracking-tight">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Clean Projects List */}
      <div className="flex flex-col gap-4 mt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">Recent Projects</h2>
        </div>
        
        <div className="border border-border/50 rounded-xl bg-card shadow-sm overflow-hidden">
          {recentProjects.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No projects found. Create your first project to get started.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border/40">
              {recentProjects.map((data, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-secondary/20 transition-colors gap-4">
                  
                  {/* Left Side: Avatar and Info */}
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full border border-border/50 bg-secondary/30 flex items-center justify-center shrink-0 overflow-hidden">
                      <img 
                        src={`https://icons.duckduckgo.com/ip3/${data.project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}.ico`} 
                        alt=""
                        className="h-5 w-5 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          const fallbackText = document.createElement('span');
                          fallbackText.className = 'font-semibold text-sm text-foreground';
                          fallbackText.innerText = data.project.name.charAt(0).toUpperCase();
                          (e.target as HTMLImageElement).parentElement?.appendChild(fallbackText);
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/projects/${data.project.slug || data.project.name.toLowerCase()}`} className="text-sm font-semibold hover:underline">
                          {data.project.name}
                        </Link>
                        <span className="px-1.5 py-0.5 rounded-md bg-secondary text-[10px] font-medium text-muted-foreground">
                          {data.project.framework || 'Next.js'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <GitBranch className="h-3 w-3" />
                          <span className="truncate max-w-[150px]">{data.repository?.githubRepositoryName || 'Local code'}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-success"></span>
                          Production
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Right Side: Actions */}
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground hidden sm:flex" asChild>
                      <Link href={`/dashboard/projects/${data.project.slug || data.project.name.toLowerCase()}`}>Manage</Link>
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 bg-transparent text-muted-foreground hover:text-foreground border-border/50" asChild>
                      <a href={`https://${data.project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                        Visit <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                  
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
