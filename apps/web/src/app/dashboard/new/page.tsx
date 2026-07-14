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

  // Using standard simple SVG path for official GitHub logo to match brand guidelines perfectly
  const GithubIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );

  return (
    <div className="max-w-[1040px] mx-auto w-full pb-20">
      <div className="flex flex-col gap-1.5 mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">Let's build something new.</h1>
        <p className="text-[15px] text-zinc-400">To deploy a new project, select a repository from your GitHub account.</p>
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
              className="flex items-start gap-4 p-6 rounded-2xl border border-zinc-800 bg-[#0c0c0c] hover:bg-zinc-900 hover:border-zinc-700 cursor-pointer transition-all group"
              onClick={() => setProjectType("static")}
            >
              <div className="h-12 w-12 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center shrink-0 group-hover:bg-zinc-800 transition-colors">
                <Globe className="h-6 w-6 text-zinc-300" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[16px] font-semibold text-white">Frontend Framework</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">Deploy a static site or frontend application like Next.js, React, Vue, or plain HTML.</p>
              </div>
            </div>
            
            <div 
              className="flex items-start gap-4 p-6 rounded-2xl border border-zinc-800 bg-[#0c0c0c] hover:bg-zinc-900 hover:border-zinc-700 cursor-pointer transition-all group"
              onClick={() => setProjectType("web")}
            >
              <div className="h-12 w-12 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center shrink-0 group-hover:bg-zinc-800 transition-colors">
                <Box className="h-6 w-6 text-zinc-300" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[16px] font-semibold text-white">Backend Web Service</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">Deploy a backend server or API like Node.js, Express, Python Flask, or Go.</p>
              </div>
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
            <div className="flex gap-3 items-center">
              <Button variant="ghost" onClick={() => setProjectType(null)} className="h-12 px-4 rounded-xl border border-zinc-800 bg-[#0c0c0c] text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all font-medium">
                ← Back
              </Button>
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-zinc-500" />
                <Input
                  placeholder="Search your GitHub repositories..."
                  className="pl-11 h-12 bg-[#0c0c0c] border-zinc-800 text-white placeholder:text-zinc-500 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-white/30 rounded-xl text-[15px] shadow-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col border border-zinc-800 rounded-2xl bg-[#0c0c0c] overflow-hidden shadow-sm">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800 bg-[#111111]">
                <GithubIcon className="h-[18px] w-[18px] text-white" />
                <span className="text-[14px] font-medium text-white">Import from GitHub</span>
              </div>
              
              {loading ? (
                <div className="p-16 text-center text-zinc-500 flex flex-col items-center justify-center">
                  <div className="h-8 w-8 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin mb-4" />
                  <span className="text-[14px]">Loading repositories...</span>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-16 text-center text-zinc-500 text-[15px]">
                  No repositories found matching "{search}"
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/60 max-h-[600px] overflow-y-auto">
                  {filteredRepos.map(repo => (
                    <div key={repo.id} className="flex items-center justify-between p-5 hover:bg-zinc-900/50 transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center shrink-0 text-zinc-400 group-hover:text-white transition-colors">
                          <GithubIcon className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="font-semibold text-[15px] text-white flex items-center gap-2">
                            {repo.name}
                            {repo.private ? (
                              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-700 bg-zinc-800/50 text-[10px] text-zinc-400 font-medium tracking-wide uppercase">
                                <Lock className="h-3 w-3" /> Private
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-800 bg-zinc-800/20 text-[10px] text-zinc-500 font-medium tracking-wide uppercase">
                                <Globe className="h-3 w-3" /> Public
                              </div>
                            )}
                          </div>
                          <div className="text-[12.5px] text-zinc-500 flex items-center gap-2.5">
                            <span className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                              {repo.language || "Unknown"}
                            </span>
                            <span>•</span>
                            <span>Updated {formatDistanceToNow(new Date(repo.updated_at))} ago</span>
                          </div>
                        </div>
                      </div>
                      <Button 
                        onClick={() => { setSelectedRepo(repo); setProjectName(repo.name); }} 
                        className="bg-white text-black hover:bg-zinc-200 font-semibold rounded-lg h-9 px-5 text-[13px] shadow-[0_0_0_1px_rgba(255,255,255,0.1)] transition-all"
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
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            <div className="lg:col-span-2 flex flex-col gap-8">
              <div className="flex flex-col rounded-2xl border border-zinc-800 bg-[#0c0c0c] overflow-hidden shadow-sm">
                <div className="p-7 border-b border-zinc-800">
                  <h2 className="text-[18px] font-bold text-white mb-1.5">Configure Project</h2>
                  <p className="text-[14px] text-zinc-400">Review and modify the deployment settings for {selectedRepo.name}</p>
                </div>
                
                <div className="p-7 space-y-7">
                  <div className="space-y-2.5">
                    <label className="text-[13px] font-semibold text-zinc-300">Project Name</label>
                    <Input 
                      value={projectName} 
                      onChange={e => setProjectName(e.target.value)} 
                      placeholder="my-awesome-project" 
                      className="h-11 bg-zinc-900 border-zinc-700 focus-visible:ring-1 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50 rounded-xl text-[14px]"
                    />
                  </div>
                  
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[13px] font-semibold text-zinc-300">Framework Preset</label>
                      {isDetecting && <span className="text-[11px] text-indigo-400 font-medium animate-pulse flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Auto-detecting...</span>}
                    </div>
                    <div className="relative">
                      <select 
                        className="w-full h-11 bg-zinc-900 border border-zinc-700 rounded-xl px-4 text-[14px] text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all appearance-none cursor-pointer"
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
                      <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-zinc-500">
                        ▼
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2.5">
                    <label className="text-[13px] font-semibold text-zinc-300">Root Directory</label>
                    <Input 
                      value={rootDir} 
                      onChange={e => setRootDir(e.target.value)} 
                      placeholder="./" 
                      className="h-11 bg-zinc-900 border-zinc-700 focus-visible:ring-1 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50 rounded-xl text-[14px]"
                    />
                  </div>

                  <div className="pt-7 mt-7 border-t border-zinc-800">
                    <h3 className="text-[15px] font-semibold text-white mb-5">Build & Development Settings</h3>
                    <div className="grid grid-cols-1 gap-5">
                      <div className="space-y-2">
                        <label className="text-[12.5px] font-medium text-zinc-400">Build Command</label>
                        <Input 
                          value={buildCmd} 
                          onChange={e => setBuildCmd(e.target.value)} 
                          placeholder="npm run build" 
                          className="h-10 bg-[#050505] border-zinc-800 focus-visible:ring-1 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50 rounded-lg font-mono text-[13px] shadow-inner"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[12.5px] font-medium text-zinc-400">Output Directory</label>
                        <Input 
                          value={outputDir} 
                          onChange={e => setOutputDir(e.target.value)} 
                          placeholder=".next, build, public" 
                          className="h-10 bg-[#050505] border-zinc-800 focus-visible:ring-1 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50 rounded-lg font-mono text-[13px] shadow-inner"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[12.5px] font-medium text-zinc-400">Install Command</label>
                        <Input 
                          value={installCmd} 
                          onChange={e => setInstallCmd(e.target.value)} 
                          placeholder="npm install, yarn install" 
                          className="h-10 bg-[#050505] border-zinc-800 focus-visible:ring-1 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50 rounded-lg font-mono text-[13px] shadow-inner"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-7 mt-7 border-t border-zinc-800">
                    <div 
                      className="flex items-center justify-between cursor-pointer group py-2"
                      onClick={() => setShowEnvVars(!showEnvVars)}
                    >
                      <h3 className="text-[15px] font-semibold text-white group-hover:text-indigo-400 transition-colors">Environment Variables</h3>
                      <span className="text-zinc-500 text-[13px] font-medium bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800 group-hover:bg-zinc-800 transition-colors">{showEnvVars ? "Hide" : "Expand"}</span>
                    </div>
                    
                    {showEnvVars && (
                      <div className="mt-5 space-y-5">
                        <div className="flex justify-between items-center">
                          <span className="text-[12px] text-zinc-500 flex items-center gap-1.5"><Lock className="h-3 w-3" /> Variables are securely encrypted at rest.</span>
                          <Button variant="ghost" size="sm" onClick={() => setIsBulkMode(!isBulkMode)} className="h-8 text-[12px] font-medium text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-lg px-3">
                            {isBulkMode ? 'Switch to Single Input' : 'Switch to Bulk Paste'}
                          </Button>
                        </div>
                        
                        {isBulkMode ? (
                          <div className="space-y-3">
                            <textarea 
                              className="w-full min-h-[180px] bg-[#050505] border border-zinc-800 rounded-xl p-4 text-[13px] text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 font-mono shadow-inner transition-all leading-relaxed"
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
                              <div key={index} className="flex items-center gap-3">
                                <Input 
                                  placeholder="KEY" 
                                  value={envVar.key} 
                                  onChange={(e) => updateEnvVar(index, "key", e.target.value)} 
                                  onPaste={(e) => handleEnvPaste(e, index)}
                                  className="h-10 font-mono text-[13px] bg-[#050505] border-zinc-800 rounded-lg"
                                />
                                <Input 
                                  placeholder="VALUE" 
                                  value={envVar.value} 
                                  onChange={(e) => updateEnvVar(index, "value", e.target.value)} 
                                  onPaste={(e) => handleEnvPaste(e, index)}
                                  className="h-10 font-mono text-[13px] bg-[#050505] border-zinc-800 rounded-lg"
                                />
                                <Button variant="ghost" size="icon" onClick={() => removeEnvVar(index)} className="h-10 w-10 shrink-0 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg border border-transparent hover:border-red-400/20 transition-all">
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={addEnvVar} className="w-full border-dashed border-zinc-700 bg-transparent hover:bg-zinc-900 text-zinc-400 hover:text-white rounded-xl h-11 font-medium mt-2">
                              <Plus className="mr-2 h-4 w-4" /> Add Variable
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-4">
                <Button variant="outline" onClick={() => setSelectedRepo(null)} disabled={isDeploying} className="bg-transparent border-zinc-700 text-white hover:bg-zinc-800 rounded-xl px-8 h-12 font-medium">
                  Cancel
                </Button>
                <Button onClick={handleDeploy} disabled={isDeploying} className="flex-1 bg-white text-black hover:bg-zinc-200 rounded-xl h-12 font-semibold text-[15px] shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-all">
                  {isDeploying ? (
                    <div className="flex items-center justify-center gap-2.5">
                      <div className="h-4 w-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                      Deploying Project...
                    </div>
                  ) : "Deploy"}
                </Button>
              </div>
            </div>
            
            <div className="flex flex-col gap-6">
              <div className="flex flex-col rounded-2xl border border-zinc-800 bg-[#0c0c0c] overflow-hidden shadow-sm sticky top-24">
                <div className="p-5 border-b border-zinc-800 bg-[#111111] flex items-center gap-2">
                  <GithubIcon className="h-[15px] w-[15px] text-zinc-400" />
                  <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-widest">Repository</h3>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-3.5">
                    <div className="h-10 w-10 rounded-full bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center shrink-0">
                      <GithubIcon className="h-5 w-5 text-zinc-300" />
                    </div>
                    <span className="text-[14px] font-semibold text-white break-all leading-tight">{selectedRepo.full_name}</span>
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
