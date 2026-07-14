"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, SlidersHorizontal, Filter, Code, ChevronDown, Rocket, LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PremiumProjectCard } from "./PremiumProjectCard";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

export function ProjectsContentClient({ projectsData }: { projectsData: any[] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredProjects = projectsData.filter(data => 
    data.project.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-10 pb-12">
      {/* Top Header & Filters */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex flex-col gap-8"
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Projects</h1>
              <div className="px-2.5 py-0.5 rounded-full bg-secondary/50 border border-border/50 text-sm font-medium text-muted-foreground flex items-center justify-center">
                {projectsData.length}
              </div>
            </div>
            <p className="text-muted-foreground text-lg">Manage your deployments, domains, and settings.</p>
          </div>
          
          <Link href="/dashboard/new">
            <Button className="h-11 px-6 rounded-[12px] bg-accent hover:bg-accent/90 text-accent-foreground shadow-[0_0_20px_rgba(79,124,255,0.4)] hover:shadow-[0_0_30px_rgba(79,124,255,0.6)] transition-all font-medium text-base">
              <Plus className="mr-2 h-5 w-5" /> New Project
            </Button>
          </Link>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full p-2 bg-card border border-border/50 rounded-[16px]">
          <div className="relative flex-1 w-full group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 bg-transparent rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-0 transition-all placeholder:text-muted-foreground/60"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <kbd className="inline-flex h-5 items-center gap-1 rounded border border-border bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </div>
          </div>
          
          <div className="h-6 w-px bg-border/50 hidden sm:block"></div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            <div className="flex bg-secondary/50 rounded-lg p-0.5">
              <Button variant="ghost" size="icon" onClick={() => setViewMode("grid")} className={`h-8 w-8 rounded-md ${viewMode === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setViewMode("list")} className={`h-8 w-8 rounded-md ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Projects Grid / Empty State */}
      {filteredProjects.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
          className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-border/60 rounded-[32px] bg-card/20"
        >
          <div className="h-24 w-24 rounded-full bg-secondary/50 flex items-center justify-center mb-6 border border-border/50 shadow-inner relative overflow-hidden group">
            <div className="absolute inset-0 bg-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <Rocket className="h-10 w-10 text-muted-foreground group-hover:text-accent group-hover:-translate-y-1 group-hover:translate-x-1 transition-all" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">Deploy your first project</h2>
          <p className="text-muted-foreground max-w-sm mb-8">
            Connect your GitHub repository and we will automatically build, deploy, and scale your application.
          </p>
          <Link href="/dashboard/new">
            <Button className="h-11 px-8 rounded-full bg-foreground text-background hover:bg-foreground/90 font-medium">
              Import GitHub Repository
            </Button>
          </Link>
        </motion.div>
      ) : (
        <motion.div 
          variants={container} initial="hidden" animate="show"
          className={`grid gap-6 ${viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 lg:grid-cols-2"}`}
        >
          <AnimatePresence>
            {filteredProjects.map((data, i) => (
              <PremiumProjectCard 
                key={data.project.id || i} 
                project={data.project} 
                repository={data.repository} 
                delay={i * 0.05} 
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
