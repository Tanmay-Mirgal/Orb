"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, Search, Lock, Globe, Plus, Box, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type Repo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  language: string;
  updated_at: string;
};

export default function NewProjectPage() {
  const router = useRouter();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState<"static" | "web" | null>(null);
  
  // Form State
  const [isDeploying, setIsDeploying] = useState(false);
  const [framework, setFramework] = useState("Next.js");
  const [rootDir, setRootDir] = useState("./");
  const [buildCmd, setBuildCmd] = useState("npm run build");
  const [installCmd, setInstallCmd] = useState("npm install");
  const [outputDir, setOutputDir] = useState(".next");
  const [envVars, setEnvVars] = useState([{ key: "", value: "" }]);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkEnv, setBulkEnv] = useState('');

  useEffect(() => {
    // Only fetch if a project type was selected
    if (!projectType) return;
    
    setLoading(true);
    fetch("/api/github/repos")
      .then(res => res.json())
      .then(data => {
        if (data.repos) {
          setRepos(data.repos);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [projectType]);

  // Auto-detect framework
  const [isDetecting, setIsDetecting] = useState(false);
  useEffect(() => {
    if (!selectedRepo) return;

    const detectFramework = async () => {
      setIsDetecting(true);
      try {
        const res = await fetch(`/api/github/detect-framework?repo=${encodeURIComponent(selectedRepo.full_name)}&rootDir=${encodeURIComponent(rootDir)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setFramework(data.framework);
            setBuildCmd(data.buildCommand);
            setOutputDir(data.outputDirectory);
            setInstallCmd(data.installCommand);
          }
        }
      } catch (err) {
        console.error("Failed to detect framework:", err);
      } finally {
        setIsDetecting(false);
      }
    };

    const timeout = setTimeout(detectFramework, 500);
    return () => clearTimeout(timeout);
  }, [selectedRepo, rootDir]);

  const filteredRepos = repos.filter(repo => repo.name.toLowerCase().includes(search.toLowerCase()));

  const handleDeploy = async () => {
    if (!selectedRepo) return;
    setIsDeploying(true);
    
    const validEnvVars = envVars.reduce((acc, curr) => {
      if (curr.key.trim() && curr.value.trim()) {
        acc[curr.key.trim()] = curr.value.trim();
      }
      return acc;
    }, {} as Record<string, string>);

    try {
      // 1. Create Project
      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          githubRepositoryName: selectedRepo.full_name,
          githubRepositoryId: selectedRepo.id,
          branch: "main",
          framework: framework,
          buildCommand: buildCmd,
          outputDirectory: outputDir,
          rootDirectory: rootDir,
          installCommand: installCmd,
        })
      });
      const projectData = await projectRes.json();
      
      if (!projectData.success) {
        throw new Error(projectData.error || "Failed to create project");
      }

      // 2. Trigger Deployment via API
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectData.project.id,
          githubRepositoryName: selectedRepo.full_name,
          branch: "main",
          buildCommand: buildCmd,
          outputDirectory: outputDir,
          rootDirectory: rootDir,
          installCommand: installCmd,
          envVars: validEnvVars,
        })
      });
      
      const data = await res.json();
      if (data.success) {
        const slug = projectData.project.slug;
        router.push(`/dashboard/projects/${slug}`);
      }
    } catch (error) {
      console.error(error);
      setIsDeploying(false);
    }
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const updateEnvVar = (index: number, field: "key" | "value", value: string) => {
    const newVars = [...envVars];
    newVars[index][field] = value;
    setEnvVars(newVars);
  };

  const removeEnvVar = (index: number) => {
    const newVars = envVars.filter((_, i) => i !== index);
    if (newVars.length === 0) {
      newVars.push({ key: "", value: "" });
    }
    setEnvVars(newVars);
  };

  const handleEnvPaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const paste = e.clipboardData.getData('text');
    // Basic heuristic: if it has '=' and multiple lines, or even a single line like KEY=value, parse it
    if (paste.includes('=')) {
      e.preventDefault();
      const lines = paste.split('\n');
      const newVars = [...envVars];
      let currentIndex = index;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').replace(/^["'](.*)["']$/, '$1').trim();
        
        if (key && value) {
          if (currentIndex < newVars.length) {
            newVars[currentIndex] = { key: key.trim(), value };
          } else {
            newVars.push({ key: key.trim(), value });
          }
          currentIndex++;
        }
      }
      
      // If we replaced the current empty one, and we're at the end, maybe we need to append?
      // newVars is already updated with all the pasted ones
      setEnvVars(newVars);
    }
  };

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Import Git Repository</h1>
        <p className="text-sm text-muted-foreground">Select a project type and then a repository from your GitHub account.</p>
      </div>

      <AnimatePresence mode="wait">
        {!projectType ? (
          <motion.div
            key="type-selection"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <div 
              className="flex flex-col gap-3 p-6 rounded-[16px] border border-white/10 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] hover:border-white/20 transition-all group"
              onClick={() => setProjectType("static")}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                  <Globe className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-base font-semibold text-white">Static Site</h3>
              </div>
              <p className="text-sm text-muted-foreground">Deploy a frontend application like React, Vue, Next.js or plain HTML.</p>
            </div>
            
            <div 
              className="flex flex-col gap-3 p-6 rounded-[16px] border border-white/10 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] hover:border-white/20 transition-all group"
              onClick={() => setProjectType("web")}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                  <Box className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-base font-semibold text-white">Web Service</h3>
              </div>
              <p className="text-sm text-muted-foreground">Deploy a backend application like Node.js, Express, Python or Go.</p>
            </div>
          </motion.div>
        ) : !selectedRepo ? (
          <motion.div
            key="repo-list"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col gap-6"
          >
            <div className="flex gap-4 items-center">
              <Button variant="ghost" onClick={() => setProjectType(null)} className="text-muted-foreground hover:text-white hover:bg-white/5">
                ← Back
              </Button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  className="pl-9 h-11 bg-white/[0.02] border-white/10 text-white placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/20 rounded-[12px]"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col border border-white/10 rounded-[16px] bg-white/[0.02] overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                  <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin mb-4" />
                  Loading repositories...
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">
                  No repositories found matching "{search}"
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
                  {filteredRepos.map(repo => (
                    <div key={repo.id} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-[10px] bg-[#050505] border border-white/10 flex items-center justify-center shrink-0">
                          <GitBranch className="h-4 w-4 text-white/70" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="font-medium text-sm text-white flex items-center gap-2">
                            {repo.name}
                            {repo.private ? (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <Globe className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                            <span className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-400"></span>
                              {repo.language || "Unknown"}
                            </span>
                            <span>•</span>
                            Updated {new Date(repo.updated_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <Button 
                        onClick={() => { setSelectedRepo(repo); setProjectName(repo.name); }} 
                        size="sm"
                        className="bg-white text-black hover:bg-white/90 font-medium rounded-full h-8 px-4 text-xs"
                      >
                        Import
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="repo-config"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="flex flex-col rounded-[16px] border border-white/10 bg-white/[0.02] overflow-hidden">
                <div className="p-6 border-b border-white/10">
                  <h2 className="text-base font-semibold text-white mb-1">Configure Project</h2>
                  <p className="text-sm text-muted-foreground">Review and modify the deployment settings for {selectedRepo.name}</p>
                </div>
                
                <div className="p-6 space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-white/80">Project Name</label>
                    <Input 
                      value={projectName} 
                      onChange={e => setProjectName(e.target.value)} 
                      placeholder="my-awesome-project" 
                      className="bg-[#050505] border-white/10 focus-visible:ring-1 focus-visible:ring-white/20 rounded-[8px]"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-white/80">Framework Preset</label>
                      {isDetecting && <span className="text-[10px] text-muted-foreground animate-pulse">Auto-detecting...</span>}
                    </div>
                    <select 
                      className="w-full h-10 bg-[#050505] border border-white/10 rounded-[8px] px-3 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all appearance-none"
                      value={framework} 
                      onChange={e => {
                        const val = e.target.value;
                        setFramework(val);
                        if (val === "Next.js") {
                          setBuildCmd("npm run build");
                          setOutputDir(".next/standalone");
                          setInstallCmd("npm install");
                        } else if (val === "React.js") {
                          setBuildCmd("npm run build");
                          setOutputDir("dist");
                          setInstallCmd("npm install");
                        } else if (val === "Node.js") {
                          setBuildCmd("");
                          setOutputDir(".");
                          setInstallCmd("npm install");
                        } else if (val === "Flask") {
                          setBuildCmd("");
                          setOutputDir(".");
                          setInstallCmd("pip install -r requirements.txt");
                        }
                      }}
                    >
                      <option value="Next.js">Next.js</option>
                      <option value="React.js">React.js</option>
                      <option value="Node.js">Node.js</option>
                      <option value="Flask">Flask</option>
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-white/80">Root Directory</label>
                    <Input 
                      value={rootDir} 
                      onChange={e => setRootDir(e.target.value)} 
                      placeholder="./" 
                      className="bg-[#050505] border-white/10 focus-visible:ring-1 focus-visible:ring-white/20 rounded-[8px]"
                    />
                  </div>

                  <div className="pt-6 mt-6 border-t border-white/10">
                    <h3 className="text-sm font-semibold text-white mb-4">Build & Development Settings</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Build Command</label>
                        <Input 
                          value={buildCmd} 
                          onChange={e => setBuildCmd(e.target.value)} 
                          placeholder="npm run build" 
                          className="bg-[#050505] border-white/10 focus-visible:ring-1 focus-visible:ring-white/20 rounded-[8px] font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Output Directory</label>
                        <Input 
                          value={outputDir} 
                          onChange={e => setOutputDir(e.target.value)} 
                          placeholder=".next, build, public" 
                          className="bg-[#050505] border-white/10 focus-visible:ring-1 focus-visible:ring-white/20 rounded-[8px] font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Install Command</label>
                        <Input 
                          value={installCmd} 
                          onChange={e => setInstallCmd(e.target.value)} 
                          placeholder="npm install, yarn install" 
                          className="bg-[#050505] border-white/10 focus-visible:ring-1 focus-visible:ring-white/20 rounded-[8px] font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 mt-6 border-t border-white/10">
                    <div 
                      className="flex items-center justify-between cursor-pointer group"
                      onClick={() => setShowEnvVars(!showEnvVars)}
                    >
                      <h3 className="text-sm font-semibold text-white group-hover:text-white/80 transition-colors">Environment Variables</h3>
                      <span className="text-muted-foreground text-xs">{showEnvVars ? "Hide" : "Show"}</span>
                    </div>
                    
                    {showEnvVars && (
                      <div className="mt-4 space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-muted-foreground">Variables will be securely encrypted.</span>
                          <Button variant="ghost" size="sm" onClick={() => setIsBulkMode(!isBulkMode)} className="h-7 text-[11px] text-muted-foreground hover:text-white bg-white/5 rounded-full px-3">
                            {isBulkMode ? 'Switch to Single' : 'Switch to Bulk Paste'}
                          </Button>
                        </div>
                        
                        {isBulkMode ? (
                          <div className="space-y-3">
                            <textarea 
                              className="w-full min-h-[150px] bg-[#050505] border border-white/10 rounded-[8px] p-3 text-xs text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 font-mono transition-all"
                              placeholder={`KEY1=value1\nKEY2="value 2"\n# Comments are ignored`}
                              value={bulkEnv}
                              onChange={e => {
                                setBulkEnv(e.target.value);
                                const lines = e.target.value.split('\n');
                                const newVars = [];
                                for (const line of lines) {
                                  const trimmed = line.trim();
                                  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
                                  const [key, ...valueParts] = trimmed.split('=');
                                  const value = valueParts.join('=').replace(/^["'](.*)["']$/, '$1').trim();
                                  if (key && value) {
                                    newVars.push({ key: key.trim(), value });
                                  }
                                }
                                if (newVars.length === 0) newVars.push({ key: '', value: '' });
                                setEnvVars(newVars);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {envVars.map((envVar, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <Input 
                                  placeholder="KEY" 
                                  value={envVar.key} 
                                  onChange={(e) => updateEnvVar(index, "key", e.target.value)} 
                                  onPaste={(e) => handleEnvPaste(e, index)}
                                  className="font-mono text-xs bg-[#050505] border-white/10 rounded-[8px]"
                                />
                                <Input 
                                  placeholder="VALUE" 
                                  value={envVar.value} 
                                  onChange={(e) => updateEnvVar(index, "value", e.target.value)} 
                                  onPaste={(e) => handleEnvPaste(e, index)}
                                  className="font-mono text-xs bg-[#050505] border-white/10 rounded-[8px]"
                                />
                                <Button variant="ghost" size="icon" onClick={() => removeEnvVar(index)} className="h-9 w-9 shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-full">
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={addEnvVar} className="w-full border-dashed border-white/10 bg-transparent hover:bg-white/5 text-muted-foreground hover:text-white rounded-[8px] h-9">
                              <Plus className="mr-2 h-3.5 w-3.5" /> Add Variable
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setSelectedRepo(null)} disabled={isDeploying} className="bg-transparent border-white/10 text-white hover:bg-white/5 rounded-full px-6">
                  Back
                </Button>
                <Button onClick={handleDeploy} disabled={isDeploying} className="flex-1 bg-white text-black hover:bg-white/90 rounded-full font-medium">
                  {isDeploying ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                      Deploying...
                    </div>
                  ) : "Deploy"}
                </Button>
              </div>
            </div>
            
            <div className="flex flex-col gap-6">
              <div className="flex flex-col rounded-[16px] border border-white/10 bg-white/[0.02] overflow-hidden">
                <div className="p-4 border-b border-white/10 bg-white/[0.01]">
                  <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Repository</h3>
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-[#050505] border border-white/10 flex items-center justify-center shrink-0">
                      <GitBranch className="h-4 w-4 text-white/50" />
                    </div>
                    <span className="text-sm font-medium text-white truncate">{selectedRepo.full_name}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
