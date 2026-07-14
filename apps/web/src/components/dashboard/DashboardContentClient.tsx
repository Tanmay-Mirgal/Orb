"use client";

import { Box, GitBranch, Globe, ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export function DashboardContentClient({ projectsData, userName }: { projectsData: any[], userName?: string }) {
  const connectedRepos = projectsData.filter((d) => d.repository?.githubRepositoryName).length;
  
  const stats = [
    { title: "Total Projects", value: projectsData.length.toString(), icon: Box, description: "Active applications" },
    { title: "Connected Repos", value: connectedRepos.toString(), icon: GitBranch, description: "GitHub repositories" },
    { title: "Live Domains", value: projectsData.length.toString(), icon: Globe, description: "Secure .orb.dev domains" },
  ];

  // Show up to 4 most recent projects
  const recentProjects = projectsData.slice(0, 4);

  return (
    <div className="flex flex-col gap-12 pb-20 max-w-[1400px] mx-auto">
      
      {/* Premium Hero Section */}
      <div className="relative rounded-[32px] overflow-hidden bg-gradient-to-br from-indigo-500/20 via-purple-500/5 to-transparent border border-white/10 p-8 sm:p-12 shadow-2xl">
        <div className="absolute top-0 right-0 p-12 opacity-20 pointer-events-none">
          <Globe className="w-64 h-64 text-indigo-400 blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col gap-5 max-w-2xl">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-3">Welcome back, {userName}</h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              You are currently managing {projectsData.length} active projects. All systems are operational and running smoothly.
            </p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="flex flex-wrap gap-4 mt-2">
            <Button className="bg-white text-black hover:bg-white/90 rounded-full px-6 h-12 text-sm font-medium shadow-[0_0_20px_rgba(255,255,255,0.3)]" asChild>
              <Link href="/dashboard/new"><Plus className="w-4 h-4 mr-2" /> Deploy New Project</Link>
            </Button>
            <Button variant="outline" className="rounded-full px-6 h-12 text-sm font-medium border-white/10 hover:bg-white/5 text-white" asChild>
              <Link href="/dashboard/projects">View All Projects</Link>
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Real Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <motion.div 
            key={i} 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.4, delay: i * 0.1 }}
            className="flex flex-col gap-4 p-6 rounded-[24px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="h-12 w-12 rounded-[16px] bg-white/5 border border-white/10 flex items-center justify-center">
                <stat.icon className="h-5 w-5 text-indigo-400" />
              </div>
              <span className="text-4xl font-bold text-white">{stat.value}</span>
            </div>
            <div>
              <h3 className="font-semibold text-white/90 text-lg">{stat.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{stat.description}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Recent Projects List */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-2xl font-semibold text-white tracking-tight">Recent Activity</h2>
          <Link href="/dashboard/projects" className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
            View All →
          </Link>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {recentProjects.length === 0 ? (
            <div className="col-span-1 lg:col-span-2 p-12 text-center text-sm text-muted-foreground border border-white/10 rounded-[24px] bg-white/[0.02]">
              No projects yet. Create your first project to get started!
            </div>
          ) : (
            recentProjects.map((data, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="group p-6 rounded-[24px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 transition-all flex flex-col justify-between gap-6"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-14 rounded-2xl bg-secondary/50 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                      <img 
                        src={`https://icons.duckduckgo.com/ip3/${data.project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}.ico`} 
                        alt=""
                        className="h-8 w-8 object-contain"
                        onError={(e) => {
                          // Fallback to text if image fails
                          (e.target as HTMLImageElement).style.display = 'none';
                          const fallbackText = document.createElement('span');
                          fallbackText.className = 'font-bold text-lg';
                          fallbackText.innerText = data.project.name.charAt(0).toUpperCase();
                          (e.target as HTMLImageElement).parentElement?.appendChild(fallbackText);
                        }}
                      />
                    </div>
                    <div className="flex flex-col">
                      <Link href={`/dashboard/projects/${data.project.slug || data.project.name.toLowerCase()}`} className="text-xl font-semibold text-white hover:text-indigo-400 transition-colors">
                        {data.project.name}
                      </Link>
                      <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
                        Production Ready
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full bg-white/5 hover:bg-white/10 text-white border border-white/10 shrink-0" asChild>
                    <a href={`https://${data.project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`} target="_blank" rel="noopener noreferrer">
                      <ArrowUpRight className="h-5 w-5" />
                    </a>
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 p-4 rounded-[16px] bg-black/40 border border-white/5">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Framework</span>
                    <span className="text-sm font-medium text-white/90 truncate">{data.project.framework || 'Next.js'}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Repository</span>
                    <span className="text-sm font-medium text-white/90 flex items-center gap-1.5 truncate">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{data.repository?.githubRepositoryName || 'Local Code'}</span>
                    </span>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
