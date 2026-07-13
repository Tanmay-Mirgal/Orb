"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, Search, Lock, Globe, Plus, Box } from "lucide-react";
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
          name: selectedRepo.name,
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
        const slug = projectData.project.name;
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

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-12 space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Import Git Repository</h1>
        <p className="text-muted-foreground">Select a project type and then a repository from your GitHub account.</p>
      </div>

      <AnimatePresence mode="wait">
        {!projectType ? (
          <motion.div
            key="type-selection"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <Card className="cursor-pointer hover:border-foreground transition-colors group" onClick={() => setProjectType("static")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  Static Site
                </CardTitle>
                <CardDescription>Deploy a frontend application like React, Vue, Next.js or plain HTML.</CardDescription>
              </CardHeader>
            </Card>
            
            <Card className="cursor-pointer hover:border-foreground transition-colors group" onClick={() => setProjectType("web")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Box className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  Web Service
                </CardTitle>
                <CardDescription>Deploy a backend application like Node.js, Express, Python or Go.</CardDescription>
              </CardHeader>
            </Card>
          </motion.div>
        ) : !selectedRepo ? (
          <motion.div
            key="repo-list"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="flex gap-4 items-center">
              <Button variant="ghost" onClick={() => setProjectType(null)}>← Back</Button>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  className="pl-9 h-11 bg-card/50"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <Card className="bg-card/50 overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                  <div className="h-6 w-6 rounded-full border-2 border-foreground border-t-transparent animate-spin mb-4" />
                  Loading repositories...
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  No repositories found matching "{search}"
                </div>
              ) : (
                <div className="divide-y divide-border/50 max-h-[500px] overflow-y-auto">
                  {filteredRepos.map(repo => (
                    <div key={repo.id} className="flex items-center justify-between p-4 hover:bg-secondary/20 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center border border-border/50">
                          <GitBranch className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            {repo.name}
                            {repo.private ? (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <Globe className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                            <span className="flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                              {repo.language || "Unknown"}
                            </span>
                            <span>•</span>
                            Updated {new Date(repo.updated_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <Button onClick={() => setSelectedRepo(repo)} size="sm">
                        Import
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="repo-config"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Configure Project</CardTitle>
                  <CardDescription>Review and modify the deployment settings for {selectedRepo.name}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Framework Preset</label>
                      {isDetecting && <span className="text-xs text-muted-foreground animate-pulse">Auto-detecting...</span>}
                    </div>
                    <select 
                      className="w-full h-9 bg-secondary/50 border border-border/50 rounded-md px-3 text-sm focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all"
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
                    <label className="text-sm font-medium">Root Directory</label>
                    <Input value={rootDir} onChange={e => setRootDir(e.target.value)} placeholder="./" />
                  </div>

                  <div className="pt-4 border-t border-border/40">
                    <h3 className="text-sm font-semibold mb-4">Build & Development Settings</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Build Command</label>
                        <Input value={buildCmd} onChange={e => setBuildCmd(e.target.value)} placeholder="npm run build" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Output Directory</label>
                        <Input value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder=".next, build, public" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Install Command</label>
                        <Input value={installCmd} onChange={e => setInstallCmd(e.target.value)} placeholder="npm install, yarn install" />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border/40">
                    <div 
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setShowEnvVars(!showEnvVars)}
                    >
                      <h3 className="text-sm font-semibold">Environment Variables</h3>
                      <span className="text-muted-foreground">{showEnvVars ? "▲" : "▼"}</span>
                    </div>
                    
                    {showEnvVars && (
                      <div className="mt-4 space-y-3">
                        {envVars.map((envVar, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input 
                              placeholder="KEY (e.g. DATABASE_URL)" 
                              value={envVar.key} 
                              onChange={(e) => updateEnvVar(index, "key", e.target.value)} 
                              className="font-mono text-sm"
                            />
                            <Input 
                              placeholder="VALUE" 
                              value={envVar.value} 
                              onChange={(e) => updateEnvVar(index, "value", e.target.value)} 
                              className="font-mono text-sm"
                            />
                            <Button variant="ghost" size="icon" onClick={() => removeEnvVar(index)} className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive">
                              ×
                            </Button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={addEnvVar} className="w-full border-dashed">
                          <Plus className="mr-2 h-4 w-4" /> Add Variable
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              
              <div className="flex gap-4">
                <Button variant="outline" onClick={() => setSelectedRepo(null)} disabled={isDeploying}>
                  Back
                </Button>
                <Button onClick={handleDeploy} disabled={isDeploying} className="flex-1">
                  {isDeploying ? "Deploying..." : "Deploy"}
                </Button>
              </div>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Repository</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <GitBranch className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">{selectedRepo.full_name}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
