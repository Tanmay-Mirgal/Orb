"use client";

import { motion, Variants } from "framer-motion";
import { Activity, Box, Clock, Globe, ArrowUpRight, Play, GitBranch, Cpu, HardDrive, Code, Plus } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { DashboardCharts } from "@/features/dashboard/components/DashboardCharts";
import { Button } from "@/components/ui/button";

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export function DashboardContentClient({ projectsData, userName }: { projectsData: any[], userName: string }) {
  const stats = [
    { title: "Projects", value: projectsData.length.toString(), icon: Box, trend: "+2 this week" },
    { title: "Deployments", value: "24", icon: Activity, trend: "All healthy" },
    { title: "Domains", value: projectsData.length.toString(), icon: Globe, trend: "SSL secured" },
    { title: "Workers", value: "3", icon: Cpu, trend: "Running" }
  ];

  const quickActions = [
    { title: "Deploy New Project", icon: Plus, href: "/dashboard/new" },
    { title: "Import Repo", icon: Code, href: "/dashboard/new?source=github" },
    { title: "Connect Domain", icon: Globe, href: "/dashboard/domains/new" },
    { title: "Create Worker", icon: HardDrive, href: "/dashboard/workers/new" },
  ];

  return (
    <div className="flex flex-col gap-12 pb-12">
      {/* Hero Section */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex flex-col gap-4"
      >
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Good Evening, <br />
          <span className="text-muted-foreground">{userName} 👋</span>
        </h1>
        <p className="text-lg text-muted-foreground mt-2 max-w-xl">
          Build. Deploy. Scale. Here is what is happening across your infrastructure today.
        </p>
      </motion.div>

      {/* Stats Section */}
      <motion.div 
        variants={container} initial="hidden" animate="show"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {stats.map((stat, i) => (
          <motion.div key={i} variants={item} whileHover={{ scale: 1.02 }} className="transition-transform">
            <div className="group relative overflow-hidden rounded-[24px] border border-border/50 bg-card p-6 shadow-sm hover:shadow-md hover:border-border transition-all">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="flex items-start justify-between mb-4">
                <div className="h-10 w-10 rounded-full bg-secondary/50 flex items-center justify-center border border-border/50">
                  <stat.icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <div className="text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full border border-success/20">
                  {stat.trend}
                </div>
              </div>
              <div className="text-3xl font-bold tracking-tight">{stat.value}</div>
              <p className="text-sm font-medium text-muted-foreground mt-1">{stat.title}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Main Content: Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column */}
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-8">
          <motion.div variants={item} initial="hidden" animate="show">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5" /> Deployment Timeline
            </h2>
            <div className="rounded-[24px] border border-border/50 bg-card p-6">
               <DashboardCharts />
            </div>
          </motion.div>

          <motion.div variants={item} initial="hidden" animate="show">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Box className="h-5 w-5" /> Active Projects
              </h2>
              <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                <Link href="/dashboard/projects">View All <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </div>
            
            <div className="flex flex-col gap-3">
              {projectsData.length === 0 ? (
                <div className="rounded-[24px] border border-border/50 bg-card p-12 text-center text-muted-foreground">
                  No projects deployed yet. Ready to build something great?
                </div>
              ) : (
                projectsData.map((data, i) => (
                  <motion.div key={i} whileHover={{ scale: 1.01 }} className="group relative rounded-[24px] border border-border/50 bg-card p-5 hover:border-border transition-all">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.01] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-[24px]"></div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-secondary/50 flex items-center justify-center border border-border/50">
                          <span className="font-bold text-lg">{data.project.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{data.project.name}</h3>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                            <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> {data.repository?.branch || 'main'}</span>
                            <span className="h-1 w-1 rounded-full bg-border"></span>
                            <span>{data.project.framework || 'Node.js'}</span>
                            <span className="h-1 w-1 rounded-full bg-border"></span>
                            <span>Deployed {formatDistanceToNow(new Date(data.project.createdAt), { addSuffix: true })}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-success text-xs font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
                          Ready
                        </div>
                        <Button variant="secondary" size="sm" className="hidden sm:flex" asChild>
                          <a href={`https://${data.project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`} target="_blank" rel="noopener noreferrer">
                            Visit
                          </a>
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </div>

        {/* Right Column */}
        <div className="col-span-1 flex flex-col gap-8">
          <motion.div variants={item} initial="hidden" animate="show">
            <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action, i) => (
                <Link key={i} href={action.href}>
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="flex flex-col items-center justify-center gap-2 p-4 rounded-[20px] border border-border/50 bg-card hover:bg-secondary/40 hover:border-border transition-all cursor-pointer text-center h-24">
                    <action.icon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs font-medium">{action.title}</span>
                  </motion.div>
                </Link>
              ))}
            </div>
          </motion.div>
          
          <motion.div variants={item} initial="hidden" animate="show">
            <h2 className="text-xl font-semibold mb-4">Infrastructure Health</h2>
            <div className="rounded-[24px] border border-border/50 bg-card p-6 flex flex-col gap-5">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">Edge Network</span>
                <span className="text-sm font-medium text-success">100% Uptime</span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-success w-full"></div>
              </div>
              
              <div className="flex justify-between items-center mt-2">
                <span className="text-sm font-medium text-muted-foreground">Build Workers</span>
                <span className="text-sm font-medium text-warning">Medium Load</span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-warning w-[65%]"></div>
              </div>
            </div>
          </motion.div>
        </div>
        
      </div>
    </div>
  );
}
