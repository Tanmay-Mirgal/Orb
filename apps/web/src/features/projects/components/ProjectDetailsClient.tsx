"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Box, GitBranch, Globe, Terminal, Settings as SettingsIcon, Play, RefreshCcw, ExternalLink, Lock, Eye, Copy, Plus } from "lucide-react";
import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";

export function ProjectDetailsClient({ project, repository }: { project: any, repository: any }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [deploymentId, setDeploymentId] = useState<string>("");
  const [isDeploying, setIsDeploying] = useState(false);

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      const res = await fetch('/api/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          githubRepositoryName: repository?.githubRepositoryName,
          branch: repository?.branch || 'main',
          outputDirectory: project.outputDirectory
        })
      });
      const data = await res.json();
      if (data.deployment?.id) {
        setDeploymentId(data.deployment.id);
        setActiveTab("overview");
      }
    } catch (e) {
      console.error(e);
    }
    setIsDeploying(false);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border/40 pb-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg bg-secondary flex items-center justify-center border border-border/50">
            <Box className="h-6 w-6 text-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-success/10 text-success border border-success/20">
                Production
              </span>
            </div>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <GitBranch className="h-4 w-4" /> {repository?.githubRepositoryName || 'No repository linked'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" asChild>
            <a href={`https://${project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`} target="_blank" rel="noopener noreferrer">
              <Globe className="mr-2 h-4 w-4" /> Visit Site
            </a>
          </Button>
          <Button onClick={handleDeploy} disabled={isDeploying || !repository}>
            {isDeploying ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {isDeploying ? 'Deploying...' : 'Deploy'}
          </Button>
        </div>
      </div>

      {/* Tabs Nav */}
      <div className="flex items-center gap-6 border-b border-border/40 overflow-x-auto pb-[-1px]">
        {[
          { id: "overview", label: "Overview", icon: Box },
          { id: "deployments", label: "Deployments", icon: RefreshCcw },
          { id: "env", label: "Environment Variables", icon: Lock },
          { id: "settings", label: "Settings", icon: SettingsIcon },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 pb-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-2">
        {activeTab === "overview" && <OverviewTab deploymentId={deploymentId} project={project} repository={repository} />}
        {activeTab === "deployments" && <DeploymentsTab projectId={project.id} onSelect={(id) => { setDeploymentId(id); setActiveTab("overview"); }} />}
        {activeTab === "env" && <EnvironmentTab projectId={project.id} />}
        {activeTab === "settings" && <SettingsTab project={project} />}
      </div>
    </div>
  );
}

function OverviewTab({ deploymentId, project, repository }: { deploymentId: string, project: any, repository: any }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string>(deploymentId);
  
  useEffect(() => {
    if (deploymentId) {
      setActiveDeploymentId(deploymentId);
    } else {
      // Fetch latest deployment
      fetch(`/api/deployments?projectId=${project.id}`)
        .then(res => res.json())
        .then(data => {
          if(data.deployments && data.deployments.length > 0) {
            setActiveDeploymentId(data.deployments[0].id);
          }
        })
        .catch(console.error);
    }
  }, [deploymentId, project.id]);

  useEffect(() => {
    if (!activeDeploymentId) return;
    
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/deployments/${activeDeploymentId}/logs`);
        const data = await res.json();
        if (data.logs) {
          setLogs(data.logs);
        }
      } catch (err) {
        console.error('Failed to fetch logs', err);
      }
    };
    
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [activeDeploymentId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Current Deployment</CardTitle>
            <CardDescription>The deployment currently serving production traffic.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border/50 bg-secondary/20 p-6 flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-center">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-success animate-pulse"></span>
                  <span className="font-mono text-sm font-medium">Active</span>
                </div>
                <div className="text-xl font-semibold mt-2">{project.name}-prod.orb.dev</div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                  <GitBranch className="h-3 w-3" /> {repository?.branch || 'main'}
                  <span className="text-border">•</span>
                  Production deployment
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Build Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md bg-black border border-border/40 p-4 font-mono text-sm text-muted-foreground h-64 overflow-y-auto flex flex-col">
              <div className="flex flex-col gap-1">
                {logs.length === 0 ? (
                  <div>Waiting for logs... {!activeDeploymentId && '(No active deployment found)'}</div>
                ) : (
                  logs.map((log, i) => <div key={i}>{log}</div>)
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Repository</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <GitBranch className="h-4 w-4" /> {repository?.githubRepositoryName || 'None'}
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground cursor-pointer" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DeploymentsTab({ projectId, onSelect }: { projectId: string, onSelect: (id: string) => void }) {
  const [deployments, setDeployments] = useState<any[]>([]);
  
  useEffect(() => {
    fetch(`/api/deployments?projectId=${projectId}`)
      .then(res => res.json())
      .then(data => {
        if(data.deployments) setDeployments(data.deployments);
      });
  }, [projectId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deployment History</CardTitle>
        <CardDescription>A list of all previous deployments for this project. Click to view logs.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative border-l border-border/40 ml-4 py-2 space-y-8">
          {deployments.length === 0 ? (
            <div className="pl-8 text-sm text-muted-foreground">No deployments found.</div>
          ) : deployments.map((dep, i) => (
            <div key={i} className="relative pl-8">
              <span className={`absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background ${
                dep.status === "SUCCESS" ? "bg-success" : dep.status === "FAILED" ? "bg-destructive" : "bg-warning"
              }`}></span>
              <div onClick={() => onSelect(dep.id)} className="flex flex-col sm:flex-row justify-between items-start gap-4 p-4 rounded-md border border-border/50 bg-secondary/10 hover:bg-secondary/30 transition-colors cursor-pointer">
                <div>
                  <div className="font-medium mb-1">{dep.commitMessage || 'Manual Deployment'}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {dep.commitHash && <span className="font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">{dep.commitHash.substring(0, 7)}</span>}
                    {dep.commitHash && <span>•</span>}
                    <GitBranch className="h-3 w-3" /> main
                  </div>
                </div>
                <div className="flex flex-col items-start sm:items-end text-sm text-muted-foreground">
                  <div>{formatDistanceToNow(new Date(dep.createdAt), { addSuffix: true })}</div>
                  <div className="text-xs">{dep.status}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EnvironmentTab({ projectId }: { projectId: string }) {
  const [envVars, setEnvVars] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkEnv, setBulkEnv] = useState('');

  const fetchEnvVars = async () => {
    try {
      const res = await fetch(`/api/projects/env?projectId=${projectId}`);
      const data = await res.json();
      if (data.envVars) setEnvVars(data.envVars);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchEnvVars();
  }, [projectId]);

  const handleAdd = async () => {
    if (!newKey || !newValue) return;
    setIsAdding(true);
    try {
      await fetch(`/api/projects/env?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey, value: newValue })
      });
      setNewKey('');
      setNewValue('');
      fetchEnvVars();
    } catch (e) {
      console.error(e);
    }
    setIsAdding(false);
  };

  const handleBulkAdd = async () => {
    if (!bulkEnv.trim()) return;
    setIsAdding(true);
    try {
      const lines = bulkEnv.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').replace(/^["'](.*)["']$/, '$1').trim();
        if (key && value) {
          await fetch(`/api/projects/env?projectId=${projectId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key.trim(), value })
          });
        }
      }
      setBulkEnv('');
      setIsBulkMode(false);
      fetchEnvVars();
    } catch (e) {
      console.error(e);
    }
    setIsAdding(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/projects/env?projectId=${projectId}&id=${id}`, {
        method: 'DELETE'
      });
      fetchEnvVars();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row justify-between items-start">
        <div>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>Securely store secrets and configuration for your deployments.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Add New Variable</h3>
            <Button variant="ghost" size="sm" onClick={() => setIsBulkMode(!isBulkMode)}>
              {isBulkMode ? 'Switch to Single' : 'Switch to Bulk Paste'}
            </Button>
          </div>
          
          {isBulkMode ? (
            <div className="flex flex-col gap-3">
              <textarea 
                className="w-full min-h-[150px] bg-secondary/30 border border-border/50 rounded-md p-3 text-sm focus:outline-none focus:border-border font-mono"
                placeholder={`KEY1=value1\nKEY2="value 2"\n# Comments are ignored`}
                value={bulkEnv}
                onChange={e => setBulkEnv(e.target.value)}
              />
              <Button onClick={handleBulkAdd} disabled={isAdding || !bulkEnv.trim()} className="w-fit">
                <Plus className="mr-2 h-4 w-4" /> Add Multiple Variables
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <input type="text" placeholder="KEY (e.g. DATABASE_URL)" value={newKey} onChange={e => setNewKey(e.target.value)} className="flex-1 h-10 bg-secondary/30 border border-border/50 rounded-md px-3 text-sm focus:outline-none focus:border-border font-mono" />
              <input type="text" placeholder="VALUE" value={newValue} onChange={e => setNewValue(e.target.value)} className="flex-1 h-10 bg-secondary/30 border border-border/50 rounded-md px-3 text-sm focus:outline-none focus:border-border font-mono" />
              <Button onClick={handleAdd} disabled={isAdding || !newKey || !newValue}><Plus className="mr-2 h-4 w-4" /> Add Variable</Button>
            </div>
          )}
        </div>

        <div className="rounded-md border border-border/50 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground border-b border-border/50">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {envVars.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No environment variables configured.</td>
                </tr>
              ) : envVars.map((env, i) => (
                <tr key={env.id || i} className="border-b border-border/20 last:border-0 hover:bg-secondary/10">
                  <td className="px-4 py-3 font-medium font-mono">{env.key}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">••••••••••••••••</span>
                      <Lock className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(env.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C2.72386 3.5 2.5 3.72386 2.5 4C2.5 4.27614 2.72386 4.5 3 4.5H12C12.2761 4.5 12.5 4.27614 12.5 4C12.5 3.72386 12.2761 3.5 12 3.5H3ZM3.5 5.5C3.22386 5.5 3 5.72386 3 6V12.5C3 13.3284 3.67157 14 4.5 14H10.5C11.3284 14 12 13.3284 12 12.5V6C12 5.72386 11.7761 5.5 11.5 5.5H3.5Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsTab({ project }: { project: any }) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        alert('Failed to delete project');
      }
    } catch (e) {
      console.error(e);
      alert('Error deleting project');
    }
    setIsDeleting(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Build & Development Settings</CardTitle>
          <CardDescription>Configure how your project is built and served.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Build Command</label>
              <input type="text" defaultValue={project.buildCommand || ''} placeholder="npm run build" className="h-10 bg-secondary/30 border border-border/50 rounded-md px-3 text-sm focus:outline-none focus:border-border" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Output Directory</label>
              <input type="text" defaultValue={project.outputDirectory || ''} placeholder=".next" className="h-10 bg-secondary/30 border border-border/50 rounded-md px-3 text-sm focus:outline-none focus:border-border" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Framework</label>
              <input type="text" defaultValue={project.framework || ''} disabled className="h-10 bg-secondary/30 border border-border/50 rounded-md px-3 text-sm focus:outline-none focus:border-border opacity-70" />
            </div>
          </div>
          <Button className="w-fit">Save Settings</Button>
        </CardContent>
      </Card>
      
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions for this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center p-4 border border-destructive/20 rounded-md bg-destructive/5">
            <div>
              <div className="font-medium text-foreground">Delete Project</div>
              <div className="text-sm text-muted-foreground mt-1">This action cannot be undone. All deployments and domains will be permanently deleted.</div>
            </div>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete Project'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
