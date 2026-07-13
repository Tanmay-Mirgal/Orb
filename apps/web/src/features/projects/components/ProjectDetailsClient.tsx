"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { 
  GitBranch, Globe, Terminal, Settings as SettingsIcon, Play, RefreshCcw, 
  ExternalLink, Lock, Box, CheckCircle2, RotateCcw,
  Search, Key, Code, Download, Copy
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const tabs = [
  { id: "overview", label: "Overview", icon: Box },
  { id: "deployments", label: "Deployments", icon: RefreshCcw },
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "env", label: "Environment Variables", icon: Lock },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export function ProjectDetailsClient({ project, repository }: { project: any, repository: any }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [deploymentId, setDeploymentId] = useState<string>("");
  const [isDeploying, setIsDeploying] = useState(false);

  const projectUrl = `https://${project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`;

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
    <div className="flex flex-col gap-8 pb-20 text-white font-sans">
      
      {/* Clean Minimal Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <div className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-green-500/10 text-green-500 border border-green-500/20 uppercase tracking-wider">
                Production
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Code className="h-3.5 w-3.5" /> {repository?.githubRepositoryName || 'Local'}</span>
              <span className="h-1 w-1 rounded-full bg-white/20"></span>
              <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> {repository?.branch || 'main'}</span>
              <span className="h-1 w-1 rounded-full bg-white/20"></span>
              <span>{project.framework || 'Node.js'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" className="h-9 rounded-[8px] bg-white/5 border-white/10 hover:bg-white/10 hover:text-white transition-colors text-xs" asChild>
            <a href={projectUrl} target="_blank" rel="noopener noreferrer">
              Visit <ExternalLink className="ml-2 h-3 w-3" />
            </a>
          </Button>
          <Button 
            onClick={handleDeploy} 
            disabled={isDeploying || !repository}
            className="h-9 rounded-[8px] bg-white text-black hover:bg-white/90 font-medium px-4 transition-all text-xs"
          >
            {isDeploying ? <RefreshCcw className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5 fill-current" />}
            {isDeploying ? 'Deploying' : 'Deploy'}
          </Button>
        </div>
      </div>

      {/* Minimal Tabs */}
      <div className="border-b border-white/10">
        <div className="flex overflow-x-auto no-scrollbar gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative py-3 text-[13px] font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id ? "text-white" : "text-muted-foreground hover:text-white"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="active-tab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-white"
                  transition={{ type: "spring", stiffness: 400, damping: 40 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === "overview" && <OverviewTab deploymentId={deploymentId} project={project} repository={repository} projectUrl={projectUrl} />}
            {activeTab === "deployments" && <DeploymentsTab projectId={project.id} onSelect={(id) => { setDeploymentId(id); setActiveTab("overview"); }} />}
            {activeTab === "env" && <EnvironmentTab projectId={project.id} />}
            {activeTab === "settings" && <SettingsTab project={project} />}
            {activeTab === "logs" && <LogsTab />}
            {activeTab === "domains" && <DomainsTab projectUrl={projectUrl} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// OVERVIEW TAB (FOCUSED & MINIMAL)
// --------------------------------------------------------------------------------
function OverviewTab({ deploymentId, project, repository, projectUrl }: { deploymentId: string, project: any, repository: any, projectUrl: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string>(deploymentId);
  
  useEffect(() => {
    if (deploymentId) setActiveDeploymentId(deploymentId);
    else {
      fetch(`/api/deployments?projectId=${project.id}`)
        .then(res => res.json())
        .then(data => { if(data.deployments?.length > 0) setActiveDeploymentId(data.deployments[0].id); })
        .catch(console.error);
    }
  }, [deploymentId, project.id]);

  useEffect(() => {
    if (!activeDeploymentId) return;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/deployments/${activeDeploymentId}/logs`);
        const data = await res.json();
        if (data.logs) setLogs(data.logs);
      } catch (err) {}
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [activeDeploymentId]);

  return (
    <div className="flex flex-col gap-6">
      
      {/* Current Deployment Card (Minimal) */}
      <div className="rounded-[16px] border border-white/10 bg-white/[0.02] p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Production Deployment</span>
          <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline flex items-center gap-2">
            {project.name}.orb.dev <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </div>
        
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-white">Ready</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <GitBranch className="h-4 w-4" />
            <span className="font-mono text-xs">{repository?.branch || 'main'}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="font-mono text-xs">#a1b2c3d</span>
          </div>
          <div className="text-muted-foreground text-xs">
            34s ago
          </div>
        </div>
      </div>

      {/* Massive Primary Terminal */}
      <div className="rounded-[16px] border border-white/10 bg-[#050505] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-mono text-muted-foreground">build.log</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-white rounded-md"><Search className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-white rounded-md"><Copy className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-white rounded-md"><Download className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        
        <div className="p-4 font-mono text-[13px] leading-[1.6] text-gray-300 h-[600px] overflow-y-auto custom-scrollbar">
          {logs.length === 0 ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="animate-pulse">_</span> Waiting for logs...
            </div>
          ) : (
            logs.map((log, i) => {
              // Simulated ANSI colors for realistic terminal feel
              let colorClass = "text-gray-300";
              if (log.includes("error") || log.includes("failed")) colorClass = "text-red-400";
              else if (log.includes("warn")) colorClass = "text-yellow-400";
              else if (log.includes("success") || log.includes("Done")) colorClass = "text-green-400";
              else if (log.includes("info")) colorClass = "text-blue-400";

              return (
                <div key={i} className="flex gap-4 hover:bg-white/[0.02] px-2 rounded-sm group">
                  <span className="text-white/20 select-none text-[11px] pt-0.5">{(i + 1).toString().padStart(4, '0')}</span>
                  <span className={`${colorClass} whitespace-pre-wrap break-all flex-1`}>{log}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// DEPLOYMENTS TAB (MINIMAL TABLE)
// --------------------------------------------------------------------------------
function DeploymentsTab({ projectId, onSelect }: { projectId: string, onSelect: (id: string) => void }) {
  const [deployments, setDeployments] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/deployments?projectId=${projectId}`).then(res => res.json()).then(data => { if(data.deployments) setDeployments(data.deployments); });
  }, [projectId]);

  return (
    <div className="rounded-[16px] border border-white/10 bg-white/[0.02] overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="border-b border-white/10 text-muted-foreground text-xs uppercase tracking-wider">
          <tr>
            <th className="px-6 py-4 font-medium">Status</th>
            <th className="px-6 py-4 font-medium">Commit</th>
            <th className="px-6 py-4 font-medium">Branch</th>
            <th className="px-6 py-4 font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {deployments.length === 0 ? (
            <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No deployments found.</td></tr>
          ) : deployments.map((dep, i) => (
            <tr key={i} onClick={() => onSelect(dep.id)} className="hover:bg-white/[0.02] cursor-pointer transition-colors group">
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${dep.status === "SUCCESS" ? "bg-green-500" : dep.status === "FAILED" ? "bg-red-500" : "bg-yellow-500 animate-pulse"}`}></div>
                  <span className="capitalize">{dep.status.toLowerCase()}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="font-medium text-white group-hover:text-blue-400 transition-colors">{dep.commitMessage || 'Manual Deploy'}</div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">{dep.commitHash?.substring(0, 7) || '--'}</div>
              </td>
              <td className="px-6 py-4 font-mono text-xs text-muted-foreground"><GitBranch className="inline-block h-3 w-3 mr-1"/> main</td>
              <td className="px-6 py-4 text-muted-foreground text-xs">{formatDistanceToNow(new Date(dep.createdAt))} ago</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------------------
// ENVIRONMENT TAB (MINIMAL TABLE)
// --------------------------------------------------------------------------------
function EnvironmentTab({ projectId }: { projectId: string }) {
  const [envVars, setEnvVars] = useState<any[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  
  const fetchEnvVars = async () => {
    try {
      const res = await fetch(`/api/projects/env?projectId=${projectId}`);
      const data = await res.json();
      if (data.envVars) setEnvVars(data.envVars);
    } catch (e) {}
  };
  useEffect(() => { fetchEnvVars(); }, [projectId]);

  const handleAdd = async () => {
    if (!newKey || !newValue) return;
    try {
      await fetch(`/api/projects/env?projectId=${projectId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: newKey, value: newValue }) });
      setNewKey(''); setNewValue(''); fetchEnvVars();
    } catch (e) {}
  };

  const handleDelete = async (id: string) => {
    try { await fetch(`/api/projects/env?projectId=${projectId}&id=${id}`, { method: 'DELETE' }); fetchEnvVars(); } catch (e) {}
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[16px] border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="p-4 border-b border-white/10 flex flex-col md:flex-row gap-4 items-center">
          <input type="text" placeholder="KEY" value={newKey} onChange={e => setNewKey(e.target.value)} className="w-full h-9 bg-[#050505] border border-white/10 rounded-md px-3 text-sm focus:outline-none focus:border-white/30 font-mono text-white" />
          <input type="password" placeholder="VALUE" value={newValue} onChange={e => setNewValue(e.target.value)} className="w-full h-9 bg-[#050505] border border-white/10 rounded-md px-3 text-sm focus:outline-none focus:border-white/30 font-mono text-white" />
          <Button onClick={handleAdd} className="w-full md:w-auto h-9 bg-white text-black text-xs font-medium px-6">Add</Button>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="border-b border-white/5 text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4 font-medium">Name</th>
              <th className="px-6 py-4 font-medium">Value</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {envVars.length === 0 ? (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">No variables added.</td></tr>
            ) : envVars.map((env, i) => (
              <tr key={env.id || i} className="hover:bg-white/[0.02]">
                <td className="px-6 py-4 font-medium font-mono text-xs">{env.key}</td>
                <td className="px-6 py-4 text-muted-foreground font-mono text-xs">••••••••••••••••</td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => handleDelete(env.id)} className="text-muted-foreground hover:text-red-400 text-xs transition-colors">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// SETTINGS TAB (MINIMAL DANGER ZONE)
// --------------------------------------------------------------------------------
function SettingsTab({ project }: { project: any }) {
  const handleDelete = async () => {
    if (!confirm('Are you sure? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) window.location.href = '/dashboard';
    } catch (e) {}
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="rounded-[16px] border border-white/10 bg-white/[0.02] p-6 flex flex-col gap-4">
        <h2 className="text-sm font-medium">Build Settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Build Command</label>
            <input type="text" defaultValue={project.buildCommand || ''} className="h-9 bg-[#050505] border border-white/10 rounded-md px-3 text-sm font-mono text-white" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Output Directory</label>
            <input type="text" defaultValue={project.outputDirectory || ''} className="h-9 bg-[#050505] border border-white/10 rounded-md px-3 text-sm font-mono text-white" />
          </div>
        </div>
        <div className="flex justify-end mt-2">
          <Button className="h-8 text-xs bg-white text-black">Save</Button>
        </div>
      </div>
      
      <div className="rounded-[16px] border border-red-500/20 bg-red-500/5 p-6 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-red-400">Delete Project</div>
          <div className="text-xs text-muted-foreground mt-1">Permanently remove this project and all data.</div>
        </div>
        <Button variant="destructive" onClick={handleDelete} className="h-8 text-xs bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white border border-red-500/30">Delete</Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// PLACEHOLDER TABS
// --------------------------------------------------------------------------------
function LogsTab() {
  return <div className="p-12 text-center text-sm text-muted-foreground border border-white/5 rounded-[16px]">Advanced logging coming soon.</div>;
}
function DomainsTab({ projectUrl }: { projectUrl: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-white/[0.02] overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="border-b border-white/5 text-muted-foreground text-xs uppercase tracking-wider">
          <tr><th className="px-6 py-4 font-medium">Domain</th><th className="px-6 py-4 font-medium">Status</th></tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-6 py-4 font-medium text-white">{projectUrl.replace('https://', '')}</td>
            <td className="px-6 py-4"><span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">Active</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
