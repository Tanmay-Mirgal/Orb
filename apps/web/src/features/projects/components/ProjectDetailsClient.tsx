"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { 
  GitBranch, Globe, Terminal, Settings as SettingsIcon, Play, RefreshCcw, 
  ExternalLink, Lock, Box, CheckCircle2, RotateCcw, Activity, Cpu, HardDrive, 
  Wifi, ShieldAlert, Clock, Pause, Download, Search, Users, Key, Code, 
  Database, LineChart
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

const tabs = [
  { id: "overview", label: "Overview", icon: Box },
  { id: "deployments", label: "Deployments", icon: RefreshCcw },
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "analytics", label: "Analytics", icon: LineChart },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "env", label: "Environment Variables", icon: Lock },
  { id: "storage", label: "Storage", icon: Database },
  { id: "workers", label: "Workers", icon: Cpu },
  { id: "monitoring", label: "Monitoring", icon: Activity },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export function ProjectDetailsClient({ project, repository }: { project: any, repository: any }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [deploymentId, setDeploymentId] = useState<string>("");
  const [isDeploying, setIsDeploying] = useState(false);

  const projectUrl = `https://${project.name}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || 'orb.dev'}`;
  const isGithubConnected = !!repository?.githubRepositoryName;

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
    <div className="flex flex-col gap-8 pb-20">
      {/* Top Hero Section */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="h-16 w-16 rounded-[14px] bg-secondary flex items-center justify-center border border-border/50 shadow-inner">
              <span className="font-bold text-3xl">{project.name.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
                <div className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-success/10 text-success border border-success/20 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success"></span>
                  </span>
                  Ready
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline transition-colors flex items-center gap-1">
                  {project.name}.orb.dev
                </a>
                <span>•</span>
                <span className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" /> {repository?.branch || 'main'}</span>
                <span>•</span>
                <span>{project.framework || 'Node.js'}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" className="h-10 rounded-[10px] bg-secondary/50 border-border/50 hover:bg-secondary transition-colors" asChild>
              <a href={projectUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Visit
              </a>
            </Button>
            {isGithubConnected && (
              <Button variant="outline" className="h-10 rounded-[10px] bg-secondary/50 border-border/50 hover:bg-secondary transition-colors">
                <Code className="mr-2 h-4 w-4" /> Repository
              </Button>
            )}
            <Button 
              onClick={handleDeploy} 
              disabled={isDeploying || !repository}
              className="h-10 rounded-[10px] bg-foreground text-background hover:bg-foreground/90 font-medium px-6 shadow-md hover:shadow-lg transition-all"
            >
              {isDeploying ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4 fill-current" />}
              {isDeploying ? 'Deploying...' : 'Deploy'}
            </Button>
          </div>
        </div>
      </div>

      {/* Animated Navigation */}
      <div className="relative border-b border-border/40">
        <div className="flex overflow-x-auto no-scrollbar gap-2 pb-[-1px]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="active-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "overview" && <OverviewTab deploymentId={deploymentId} project={project} repository={repository} projectUrl={projectUrl} />}
            {activeTab === "deployments" && <DeploymentsTab projectId={project.id} onSelect={(id) => { setDeploymentId(id); setActiveTab("overview"); }} />}
            {activeTab === "env" && <EnvironmentTab projectId={project.id} />}
            {activeTab === "settings" && <SettingsTab project={project} />}
            
            {/* Placeholder for unimplemented premium tabs */}
            {["logs", "analytics", "domains", "storage", "workers", "monitoring"].includes(activeTab) && (
              <div className="flex flex-col items-center justify-center py-32 text-center border border-dashed border-border/50 rounded-[24px] bg-secondary/10">
                <Box className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-xl font-medium mb-2">{tabs.find(t => t.id === activeTab)?.label} (Coming Soon)</h3>
                <p className="text-muted-foreground max-w-sm">This feature is currently being engineered for the next release.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// OVERVIEW TAB (THE COMMAND CENTER)
// --------------------------------------------------------------------------------
function OverviewTab({ deploymentId, project, repository, projectUrl }: { deploymentId: string, project: any, repository: any, projectUrl: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string>(deploymentId);
  
  useEffect(() => {
    if (deploymentId) {
      setActiveDeploymentId(deploymentId);
    } else {
      fetch(`/api/deployments?projectId=${project.id}`)
        .then(res => res.json())
        .then(data => {
          if(data.deployments && data.deployments.length > 0) setActiveDeploymentId(data.deployments[0].id);
        }).catch(console.error);
    }
  }, [deploymentId, project.id]);

  useEffect(() => {
    if (!activeDeploymentId) return;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/deployments/${activeDeploymentId}/logs`);
        const data = await res.json();
        if (data.logs) setLogs(data.logs);
      } catch (err) { console.error(err); }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [activeDeploymentId]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      {/* Left Main Column */}
      <div className="xl:col-span-2 flex flex-col gap-8">
        
        {/* Current Deployment Card */}
        <div className="rounded-[24px] border border-border/40 bg-card p-6 shadow-sm relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none"></div>
          <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
              <h2 className="text-xl font-semibold mb-1">Current Deployment</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">{project.name}.orb.dev</a>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-lg h-8 px-3 border-border/50 text-xs font-medium"><RotateCcw className="mr-1.5 h-3 w-3" /> Rollback</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-5 rounded-[16px] bg-secondary/30 border border-border/40 relative z-10">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-success" /> Ready</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Environment</span>
              <div className="flex items-center gap-1.5 text-sm font-medium"><Globe className="h-4 w-4 text-muted-foreground" /> Production</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Branch</span>
              <div className="flex items-center gap-1.5 text-sm font-medium"><GitBranch className="h-4 w-4 text-muted-foreground" /> {repository?.branch || 'main'}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Duration</span>
              <div className="flex items-center gap-1.5 text-sm font-medium"><Clock className="h-4 w-4 text-muted-foreground" /> 34s</div>
            </div>
          </div>
        </div>

        {/* Deployment Timeline */}
        <div className="rounded-[24px] border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-6">Build Timeline</h2>
          <div className="flex items-center justify-between relative px-2">
            <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-secondary"></div>
            <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-success" style={{ width: '100%' }}></div>
            
            {[
              { label: 'Queued', active: true },
              { label: 'Building', active: true },
              { label: 'Uploading', active: true },
              { label: 'Deploying', active: true },
              { label: 'Live', active: true }
            ].map((step, i) => (
              <div key={i} className="relative z-10 flex flex-col items-center gap-3">
                <div className={`h-4 w-4 rounded-full border-2 ${step.active ? 'bg-success border-success' : 'bg-secondary border-border'}`}></div>
                <span className={`text-xs font-medium ${step.active ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Resource Usage Grid (Simulated) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'CPU Usage', value: '12%', icon: Cpu },
            { label: 'Memory', value: '240 MB', icon: HardDrive },
            { label: 'Bandwidth', value: '1.2 GB', icon: Wifi },
            { label: 'Errors', value: '0.01%', icon: ShieldAlert },
          ].map((stat, i) => (
            <div key={i} className="rounded-[20px] border border-border/40 bg-card p-5 flex flex-col hover:border-border transition-colors">
              <div className="flex items-center justify-between mb-3 text-muted-foreground">
                <span className="text-xs font-medium">{stat.label}</span>
                <stat.icon className="h-4 w-4" />
              </div>
              <span className="text-2xl font-semibold">{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Real-time Logs Terminal */}
        <div className="rounded-[24px] border border-border/40 bg-[#0A0A0A] overflow-hidden shadow-lg border-t-accent/20">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/20 bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium font-mono text-muted-foreground">build.log</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"><Search className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"><Download className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"><Pause className="h-3 w-3" /></Button>
            </div>
          </div>
          <div className="p-4 font-mono text-[13px] leading-relaxed text-muted-foreground h-80 overflow-y-auto flex flex-col gap-1 selection:bg-accent/30 selection:text-foreground">
            {logs.length === 0 ? (
              <div className="animate-pulse">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="hover:bg-white/[0.02] px-1 -mx-1 rounded whitespace-pre-wrap break-all">
                  <span className="text-border mr-3 select-none">{(i + 1).toString().padStart(3, '0')}</span>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right Context Panel */}
      <div className="flex flex-col gap-6">
        <div className="rounded-[24px] border border-border/40 bg-card p-6">
          <h3 className="text-sm font-semibold mb-5">Repository Details</h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Connected Repo</span>
              <span className="text-sm font-medium flex items-center gap-1.5"><Code className="h-3.5 w-3.5" /> {repository?.githubRepositoryName || 'None'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Production Branch</span>
              <span className="text-sm font-medium font-mono bg-secondary px-2 py-0.5 rounded-md">{repository?.branch || 'main'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Latest Commit</span>
              <span className="text-sm font-medium font-mono text-accent">#a1b2c3d</span>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-border/40 bg-card p-6">
          <h3 className="text-sm font-semibold mb-5">Team & Security</h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Team Members</span>
              <div className="flex items-center -space-x-2">
                <div className="h-6 w-6 rounded-full bg-accent/20 border border-border flex items-center justify-center text-[10px] font-bold z-20">T</div>
                <div className="h-6 w-6 rounded-full bg-success/20 border border-border flex items-center justify-center text-[10px] font-bold z-10">M</div>
                <div className="h-6 w-6 rounded-full bg-secondary border border-border flex items-center justify-center text-[10px] font-medium"><Users className="h-3 w-3" /></div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Environment Variables</span>
              <span className="text-sm font-medium flex items-center gap-1.5"><Key className="h-3.5 w-3.5" /> 8 Secrets</span>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-border/40 bg-card p-6">
          <h3 className="text-sm font-semibold mb-5">Infrastructure</h3>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Region</span>
              <span className="text-sm font-medium flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> iad1 (US East)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Edge Network</span>
              <span className="text-sm font-medium text-success">Optimal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// DEPLOYMENTS TAB
// --------------------------------------------------------------------------------
function DeploymentsTab({ projectId, onSelect }: { projectId: string, onSelect: (id: string) => void }) {
  const [deployments, setDeployments] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/deployments?projectId=${projectId}`).then(res => res.json()).then(data => { if(data.deployments) setDeployments(data.deployments); });
  }, [projectId]);

  return (
    <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden">
      <div className="p-6 border-b border-border/40">
        <h2 className="text-lg font-semibold">Deployment History</h2>
        <p className="text-sm text-muted-foreground mt-1">A comprehensive log of all successful and failed builds.</p>
      </div>
      <div className="divide-y divide-border/20">
        {deployments.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No deployments found.</div>
        ) : deployments.map((dep, i) => (
          <div key={i} onClick={() => onSelect(dep.id)} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 hover:bg-secondary/20 transition-colors cursor-pointer group">
            <div className="flex items-start gap-4">
              <div className={`mt-0.5 h-2 w-2 rounded-full ring-4 ring-background ${dep.status === "SUCCESS" ? "bg-success" : dep.status === "FAILED" ? "bg-destructive" : "bg-warning animate-pulse"}`}></div>
              <div>
                <div className="font-medium group-hover:text-accent transition-colors">{dep.commitMessage || 'Manual Deployment'}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                  {dep.commitHash && <span className="font-mono">{dep.commitHash.substring(0, 7)}</span>}
                  {dep.commitHash && <span>•</span>}
                  <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> main</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end text-sm text-muted-foreground gap-1">
              <div>{formatDistanceToNow(new Date(dep.createdAt), { addSuffix: true })}</div>
              <div className="text-xs uppercase tracking-wider font-semibold">{dep.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// ENVIRONMENT TAB
// --------------------------------------------------------------------------------
function EnvironmentTab({ projectId }: { projectId: string }) {
  const [envVars, setEnvVars] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  
  const fetchEnvVars = async () => {
    try {
      const res = await fetch(`/api/projects/env?projectId=${projectId}`);
      const data = await res.json();
      if (data.envVars) setEnvVars(data.envVars);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { fetchEnvVars(); }, [projectId]);

  const handleAdd = async () => {
    if (!newKey || !newValue) return;
    setIsAdding(true);
    try {
      await fetch(`/api/projects/env?projectId=${projectId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: newKey, value: newValue }) });
      setNewKey(''); setNewValue(''); fetchEnvVars();
    } catch (e) { console.error(e); }
    setIsAdding(false);
  };
  const handleDelete = async (id: string) => {
    try { await fetch(`/api/projects/env?projectId=${projectId}&id=${id}`, { method: 'DELETE' }); fetchEnvVars(); } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden">
        <div className="p-6 border-b border-border/40">
          <h2 className="text-lg font-semibold">Environment Variables</h2>
          <p className="text-sm text-muted-foreground mt-1">Securely inject secrets and configuration into your deployments.</p>
        </div>
        <div className="p-6 bg-secondary/10 border-b border-border/40 flex flex-col md:flex-row items-center gap-4">
          <input type="text" placeholder="KEY (e.g. DATABASE_URL)" value={newKey} onChange={e => setNewKey(e.target.value)} className="w-full md:w-auto flex-1 h-10 bg-background border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent font-mono transition-colors" />
          <input type="password" placeholder="VALUE" value={newValue} onChange={e => setNewValue(e.target.value)} className="w-full md:w-auto flex-1 h-10 bg-background border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent font-mono transition-colors" />
          <Button onClick={handleAdd} disabled={isAdding || !newKey || !newValue} className="w-full md:w-auto bg-foreground text-background">Add Variable</Button>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-secondary/30 text-muted-foreground border-b border-border/40">
            <tr>
              <th className="px-6 py-4 font-medium">Name</th>
              <th className="px-6 py-4 font-medium">Value</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {envVars.length === 0 ? (
              <tr><td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">No environment variables configured.</td></tr>
            ) : envVars.map((env, i) => (
              <tr key={env.id || i} className="hover:bg-secondary/10 transition-colors">
                <td className="px-6 py-4 font-medium font-mono">{env.key}</td>
                <td className="px-6 py-4"><div className="flex items-center gap-2"><span className="text-muted-foreground">••••••••••••••••</span></div></td>
                <td className="px-6 py-4 text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(env.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">Delete</Button>
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
// SETTINGS TAB
// --------------------------------------------------------------------------------
function SettingsTab({ project }: { project: any }) {
  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) window.location.href = '/dashboard';
      else alert('Failed to delete project');
    } catch (e) { console.error(e); alert('Error deleting project'); }
  };

  return (
    <div className="flex flex-col gap-8 max-w-4xl">
      <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden">
        <div className="p-6 border-b border-border/40">
          <h2 className="text-lg font-semibold">Build & Development</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure how your project is built and served.</p>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Build Command</label>
            <input type="text" defaultValue={project.buildCommand || ''} placeholder="npm run build" className="h-10 bg-secondary/30 border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent font-mono" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Output Directory</label>
            <input type="text" defaultValue={project.outputDirectory || ''} placeholder=".next" className="h-10 bg-secondary/30 border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent font-mono" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Framework</label>
            <input type="text" defaultValue={project.framework || ''} disabled className="h-10 bg-secondary/10 border border-border/50 rounded-lg px-3 text-sm text-muted-foreground opacity-70" />
          </div>
        </div>
        <div className="p-6 border-t border-border/40 bg-secondary/10 flex justify-end">
          <Button className="bg-foreground text-background">Save Configuration</Button>
        </div>
      </div>
      
      <div className="rounded-[24px] border border-destructive/30 bg-destructive/5 overflow-hidden">
        <div className="p-6 border-b border-destructive/20">
          <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
          <p className="text-sm text-muted-foreground mt-1">Irreversible actions for this project.</p>
        </div>
        <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="font-medium text-foreground">Delete Project</div>
            <div className="text-sm text-muted-foreground mt-1">Permanently delete this project, all deployments, and domains.</div>
          </div>
          <Button variant="destructive" onClick={handleDelete} className="rounded-lg">Delete Project</Button>
        </div>
      </div>
    </div>
  );
}
