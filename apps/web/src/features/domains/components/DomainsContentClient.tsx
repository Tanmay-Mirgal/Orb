"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { 
  Globe, Plus, Search, ShieldCheck, Activity, AlertCircle, 
  ExternalLink, Copy, Settings, RefreshCcw, Lock, Unlock, 
  Server, ArrowRight, CheckCircle2, ChevronRight, X, LineChart, Users
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatDistanceToNow } from "date-fns";

// Mock data for domains
const mockDomains = [
  {
    id: "1",
    name: "orb.dev",
    isPrimary: true,
    projectId: "proj_1",
    projectName: "Orb Platform",
    status: "active",
    ssl: "active",
    dns: "propagated",
    cdn: "proxied",
    registrar: "Cloudflare",
    region: "global",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(),
    lastVerified: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    traffic: Array.from({ length: 24 }).map((_, i) => ({ time: `${i}:00`, requests: Math.floor(Math.random() * 5000) + 1000 }))
  },
  {
    id: "2",
    name: "api.orb.dev",
    isPrimary: false,
    projectId: "proj_1",
    projectName: "Orb API",
    status: "active",
    ssl: "active",
    dns: "propagated",
    cdn: "proxied",
    registrar: "Cloudflare",
    region: "global",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 300).toISOString(),
    lastVerified: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    traffic: Array.from({ length: 24 }).map((_, i) => ({ time: `${i}:00`, requests: Math.floor(Math.random() * 15000) + 5000 }))
  },
  {
    id: "3",
    name: "docs.orb.dev",
    isPrimary: false,
    projectId: "proj_2",
    projectName: "Orb Docs",
    status: "pending",
    ssl: "pending",
    dns: "propagating",
    cdn: "dns_only",
    registrar: "Vercel",
    region: "iad1",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
    lastVerified: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    traffic: Array.from({ length: 24 }).map((_, i) => ({ time: `${i}:00`, requests: Math.floor(Math.random() * 500) }))
  }
];

export function DomainsContentClient() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<any>(null);

  const filteredDomains = mockDomains.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col gap-8 pb-20 max-w-7xl mx-auto">
      {/* Header & Metrics */}
      <div className="flex flex-col gap-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Domains</h1>
            <p className="text-muted-foreground mt-1 text-sm">Manage custom domains, SSL certificates, and DNS settings.</p>
          </div>
          <Button className="h-10 rounded-[10px] bg-foreground text-background hover:bg-foreground/90 font-medium px-5 shadow-md transition-all">
            <Plus className="mr-2 h-4 w-4" /> Add Domain
          </Button>
        </div>

        {/* Global Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Connected Domains" value={mockDomains.length} icon={Globe} color="text-foreground" />
          <MetricCard title="Active SSL Certs" value="2" icon={ShieldCheck} color="text-success" />
          <MetricCard title="DNS Health" value="100%" icon={Activity} color="text-accent" />
          <MetricCard title="Issues Detected" value="1" icon={AlertCircle} color="text-warning" alert />
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-border/40 pb-6">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search domains... ⌘K" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 h-10 bg-secondary/30 border border-border/50 rounded-[10px] text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" className="h-10 rounded-[10px] border-border/50 bg-background hover:bg-secondary/50 w-full sm:w-auto">
            All Projects
          </Button>
          <Button variant="outline" className="h-10 rounded-[10px] border-border/50 bg-background hover:bg-secondary/50 w-full sm:w-auto">
            Status: All
          </Button>
        </div>
      </div>

      {/* Domains List */}
      <div className="grid grid-cols-1 gap-4">
        <AnimatePresence>
          {filteredDomains.map((domain, idx) => (
            <motion.div
              key={domain.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <DomainCard domain={domain} onClick={() => setSelectedDomain(domain)} />
            </motion.div>
          ))}
          {filteredDomains.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center justify-center border border-dashed border-border/50 rounded-[24px]">
              <Globe className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium">No domains found</h3>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your search criteria.</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Domain Detail Modal / Drawer */}
      <AnimatePresence>
        {selectedDomain && (
          <DomainDetailsPanel domain={selectedDomain} onClose={() => setSelectedDomain(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// --------------------------------------------------------------------------------
// METRIC CARD COMPONENT
// --------------------------------------------------------------------------------
function MetricCard({ title, value, icon: Icon, color, alert }: any) {
  return (
    <div className={`rounded-[20px] border border-border/40 bg-card p-5 relative overflow-hidden ${alert ? 'border-warning/30 bg-warning/5' : ''}`}>
      <div className="flex items-center justify-between mb-3 relative z-10">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <div className={`h-8 w-8 rounded-full bg-secondary/50 flex items-center justify-center ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="text-3xl font-bold tracking-tight relative z-10">{value}</div>
      {alert && <div className="absolute -top-10 -right-10 w-32 h-32 bg-warning/10 blur-3xl rounded-full"></div>}
    </div>
  );
}

// --------------------------------------------------------------------------------
// DOMAIN CARD COMPONENT
// --------------------------------------------------------------------------------
function DomainCard({ domain, onClick }: { domain: any, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="group relative rounded-[20px] border border-border/40 bg-card p-1 hover:border-border transition-all cursor-pointer overflow-hidden shadow-sm hover:shadow-md"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
      
      <div className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
        {/* Left: Domain Name & Badges */}
        <div className="flex flex-col gap-3 flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold tracking-tight">{domain.name}</h3>
            {domain.isPrimary && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded-full bg-foreground text-background">Primary</span>
            )}
            {domain.status === 'active' ? (
               <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded-full bg-success/10 text-success border border-success/20">Production</span>
            ) : (
               <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded-full bg-warning/10 text-warning border border-warning/20">Pending Setup</span>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5 hover:text-foreground transition-colors">
              <Server className="h-3.5 w-3.5" />
              <span>Project: <span className="font-medium text-foreground">{domain.projectName}</span></span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-1.5">
              <span>Registrar: {domain.registrar}</span>
            </div>
          </div>
        </div>

        {/* Right: Status Indicators */}
        <div className="flex flex-wrap items-center gap-6 md:gap-8 bg-secondary/20 px-5 py-3 rounded-[14px] border border-border/30 w-full md:w-auto">
          {/* SSL Status */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">SSL Cert</span>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {domain.ssl === 'active' ? (
                <><Lock className="h-4 w-4 text-success" /> <span className="text-success">Active</span></>
              ) : (
                <><Unlock className="h-4 w-4 text-warning" /> <span className="text-warning">Issuing</span></>
              )}
            </div>
          </div>

          {/* DNS Status */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">DNS</span>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {domain.dns === 'propagated' ? (
                <><CheckCircle2 className="h-4 w-4 text-accent" /> Propagated</>
              ) : (
                <><RefreshCcw className="h-4 w-4 text-warning animate-spin" /> Propagating</>
              )}
            </div>
          </div>

          {/* CDN Proxy Status */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Edge CDN</span>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {domain.cdn === 'proxied' ? (
                <><Activity className="h-4 w-4 text-foreground" /> Proxied</>
              ) : (
                <><ArrowRight className="h-4 w-4 text-muted-foreground" /> DNS Only</>
              )}
            </div>
          </div>

          <div className="hidden lg:flex items-center justify-center pl-2">
             <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// DOMAIN DETAILS PANEL (DRAWER/MODAL)
// --------------------------------------------------------------------------------
function DomainDetailsPanel({ domain, onClose }: { domain: any, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState('dns');

  return (
    <>
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div 
        initial={{ x: '100%', opacity: 0.5 }} 
        animate={{ x: 0, opacity: 1 }} 
        exit={{ x: '100%', opacity: 0.5 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 right-0 w-full md:w-[800px] bg-[#050505] border-l border-border/50 shadow-2xl z-50 overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#050505]/90 backdrop-blur-xl border-b border-border/40 z-20 px-8 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-[10px] bg-secondary flex items-center justify-center border border-border/50">
                <Globe className="h-5 w-5 text-foreground" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">{domain.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 rounded-lg" asChild>
                <a href={`https://${domain.name}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-3 w-3" /> Visit</a>
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-secondary"><X className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="flex gap-6 overflow-x-auto no-scrollbar">
            {['dns', 'ssl', 'analytics', 'settings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium transition-colors relative whitespace-nowrap capitalize ${activeTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {tab === 'dns' ? 'DNS Records' : tab === 'ssl' ? 'SSL/TLS' : tab}
                {activeTab === tab && (
                  <motion.div layoutId="detail-tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="p-8">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              
              {/* DNS TAB */}
              {activeTab === 'dns' && (
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">DNS Management</h3>
                      <p className="text-sm text-muted-foreground">Manage the DNS records for your domain.</p>
                    </div>
                    <Button className="h-9 rounded-lg"><Plus className="mr-2 h-4 w-4" /> Add Record</Button>
                  </div>
                  
                  <div className="rounded-[16px] border border-border/40 bg-card overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-secondary/30 text-muted-foreground border-b border-border/40">
                        <tr>
                          <th className="px-5 py-3 font-medium">Type</th>
                          <th className="px-5 py-3 font-medium">Name</th>
                          <th className="px-5 py-3 font-medium">Content</th>
                          <th className="px-5 py-3 font-medium">TTL</th>
                          <th className="px-5 py-3 font-medium text-right">Proxy</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {/* Mock Records */}
                        <tr className="hover:bg-secondary/10">
                          <td className="px-5 py-4 font-mono font-medium">A</td>
                          <td className="px-5 py-4 font-mono">@</td>
                          <td className="px-5 py-4 font-mono">76.76.21.21</td>
                          <td className="px-5 py-4 text-muted-foreground">Auto</td>
                          <td className="px-5 py-4 text-right"><Activity className="h-4 w-4 text-accent ml-auto" /></td>
                        </tr>
                        <tr className="hover:bg-secondary/10">
                          <td className="px-5 py-4 font-mono font-medium">CNAME</td>
                          <td className="px-5 py-4 font-mono">www</td>
                          <td className="px-5 py-4 font-mono">cname.orb.dev</td>
                          <td className="px-5 py-4 text-muted-foreground">Auto</td>
                          <td className="px-5 py-4 text-right"><Activity className="h-4 w-4 text-accent ml-auto" /></td>
                        </tr>
                        <tr className="hover:bg-secondary/10">
                          <td className="px-5 py-4 font-mono font-medium">TXT</td>
                          <td className="px-5 py-4 font-mono">_dmarc</td>
                          <td className="px-5 py-4 font-mono text-xs max-w-[200px] truncate">v=DMARC1; p=reject;</td>
                          <td className="px-5 py-4 text-muted-foreground">3600</td>
                          <td className="px-5 py-4 text-right"><ArrowRight className="h-4 w-4 text-muted-foreground ml-auto" /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ANALYTICS TAB */}
              {activeTab === 'analytics' && (
                <div className="flex flex-col gap-6">
                  <div>
                    <h3 className="text-lg font-semibold">Edge Traffic Analytics</h3>
                    <p className="text-sm text-muted-foreground">Real-time simulated requests over the last 24 hours.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-[16px] border border-border/40 bg-card p-5">
                      <div className="text-sm font-medium text-muted-foreground mb-1">Total Requests</div>
                      <div className="text-3xl font-bold tracking-tight">1.2M</div>
                    </div>
                    <div className="rounded-[16px] border border-border/40 bg-card p-5">
                      <div className="text-sm font-medium text-muted-foreground mb-1">Bandwidth</div>
                      <div className="text-3xl font-bold tracking-tight">45.2 GB</div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-border/40 bg-card p-6 h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={domain.traffic}>
                        <defs>
                          <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4F7CFF" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#4F7CFF" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="rgba(255,255,255,0.2)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${(value/1000).toFixed(1)}k`} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#050505', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Area type="monotone" dataKey="requests" stroke="#4F7CFF" strokeWidth={2} fillOpacity={1} fill="url(#colorRequests)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* SSL & SETTINGS PLACEHOLDERS */}
              {(activeTab === 'ssl' || activeTab === 'settings') && (
                <div className="py-20 text-center flex flex-col items-center justify-center border border-dashed border-border/50 rounded-[24px]">
                  <Settings className="h-10 w-10 text-muted-foreground/30 mb-4 animate-spin-slow" />
                  <h3 className="text-lg font-medium">{activeTab.toUpperCase()} Preferences</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">Detailed configuration panels are currently being engineered for production.</p>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}
