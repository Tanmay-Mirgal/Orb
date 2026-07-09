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
          <Button variant="outline">
            <Globe className="mr-2 h-4 w-4" /> Visit Site
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
        {activeTab === "deployments" && <DeploymentsTab projectId={project.id} />}
        {activeTab === "env" && <EnvironmentTab projectId={project.id} />}
        {activeTab === "settings" && <SettingsTab project={project} />}
      </div>
    </div>
  );
}

function OverviewTab({ deploymentId, project, repository }: { deploymentId: string, project: any, repository: any }) {
  const [logs, setLogs] = useState<string[]>([]);
  
  useEffect(() => {
    if (!deploymentId) return;
    
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/deployments/${deploymentId}/logs`);
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
  }, [deploymentId]);

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
            <div className="rounded-md bg-black border border-border/40 p-4 font-mono text-sm text-muted-foreground h-64 overflow-y-auto flex flex-col-reverse">
              <div className="flex flex-col gap-1">
                {logs.length === 0 ? (
                  <div>Waiting for logs... {deploymentId ? '' : '(No active deployment session in view)'}</div>
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

function DeploymentsTab({ projectId }: { projectId: string }) {
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
        <CardDescription>A list of all previous deployments for this project.</CardDescription>
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
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 p-4 rounded-md border border-border/50 bg-secondary/10 hover:bg-secondary/30 transition-colors cursor-pointer">
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
  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-start">
        <div>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>Securely store secrets and configuration for your deployments.</CardDescription>
        </div>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Variable</Button>
      </CardHeader>
      <CardContent>
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
              {["DATABASE_URL", "API_KEY", "NEXT_PUBLIC_APP_URL"].map((key, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-secondary/10">
                  <td className="px-4 py-3 font-medium font-mono">{key}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">••••••••••••••••</span>
                      <Lock className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><Copy className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><Eye className="h-4 w-4" /></Button>
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
            <Button variant="destructive">Delete Project</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
