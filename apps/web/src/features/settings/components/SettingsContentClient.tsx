"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { 
  Settings2, User, Users, Shield, Key, Bell, CreditCard, 
  AlertTriangle, Upload, Check, Copy, ExternalLink, Activity, 
  Smartphone, Monitor, ChevronRight, Search, Plus
} from "lucide-react";
import { format } from "date-fns";

const SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "profile", label: "Profile", icon: User },
  { id: "team", label: "Team & Members", icon: Users },
  { id: "security", label: "Security", icon: Shield },
  { id: "apikeys", label: "API Keys", icon: Key },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "danger", label: "Danger Zone", icon: AlertTriangle, danger: true },
];

export function SettingsContentClient() {
  const [activeSection, setActiveSection] = useState("general");

  return (
    <div className="flex flex-col gap-8 pb-20 max-w-7xl mx-auto min-h-screen">
      <div className="flex flex-col gap-2 border-b border-border/40 pb-8">
        <h1 className="text-3xl font-bold tracking-tight">Workspace Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your workspace preferences, billing, and team members.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-12 items-start relative">
        {/* Left Sidebar Navigation (Sticky) */}
        <div className="w-full lg:w-64 flex-shrink-0 lg:sticky lg:top-24">
          <nav className="flex flex-col space-y-1">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-sm font-medium transition-all relative ${
                  activeSection === section.id
                    ? section.danger ? "text-destructive bg-destructive/10" : "text-foreground bg-secondary/50"
                    : section.danger ? "text-destructive/70 hover:text-destructive hover:bg-destructive/5" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                }`}
              >
                <section.icon className="h-4 w-4" />
                {section.label}
                {activeSection === section.id && !section.danger && (
                  <motion.div
                    layoutId="settings-nav-indicator"
                    className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-foreground rounded-r-full"
                  />
                )}
                {activeSection === section.id && section.danger && (
                  <motion.div
                    layoutId="settings-nav-indicator-danger"
                    className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-destructive rounded-r-full"
                  />
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 w-full max-w-3xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeSection === "general" && <GeneralSettings />}
              {activeSection === "profile" && <ProfileSettings />}
              {activeSection === "team" && <TeamSettings />}
              {activeSection === "security" && <SecuritySettings />}
              {activeSection === "apikeys" && <ApiKeysSettings />}
              {activeSection === "notifications" && <NotificationsSettings />}
              {activeSection === "billing" && <BillingSettings />}
              {activeSection === "danger" && <DangerZoneSettings />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// SECTION COMPONENTS
// --------------------------------------------------------------------------------

function GeneralSettings() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-xl font-semibold mb-6">General Workspace Settings</h2>
        
        <div className="rounded-[24px] border border-border/40 bg-card p-8 flex flex-col gap-8 shadow-sm">
          {/* Logo Upload */}
          <div className="flex items-start gap-6 pb-8 border-b border-border/40">
            <div className="h-20 w-20 rounded-[16px] bg-secondary flex items-center justify-center border border-border shadow-inner flex-shrink-0">
              <span className="font-bold text-2xl">O</span>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-medium">Workspace Logo</h3>
                <p className="text-sm text-muted-foreground mt-1">This will be displayed on your team's dashboard. Recommended size: 256x256px.</p>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="h-9 rounded-lg"><Upload className="mr-2 h-4 w-4" /> Upload Image</Button>
                <Button variant="ghost" size="sm" className="h-9 rounded-lg text-muted-foreground hover:text-destructive">Remove</Button>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Workspace Name</label>
              <input type="text" defaultValue="Orb Platform" className="h-10 bg-secondary/30 border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent transition-colors w-full max-w-md" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Workspace Slug</label>
              <div className="flex items-center max-w-md">
                <span className="h-10 px-3 flex items-center bg-secondary/50 border border-r-0 border-border/50 rounded-l-lg text-sm text-muted-foreground">orb.dev/</span>
                <input type="text" defaultValue="orb-platform" className="h-10 flex-1 bg-secondary/30 border border-border/50 rounded-r-lg px-3 text-sm focus:outline-none focus:border-accent transition-colors" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Timezone</label>
              <select className="h-10 bg-secondary/30 border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent transition-colors w-full max-w-md appearance-none">
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="EST">EST (Eastern Standard Time)</option>
                <option value="PST">PST (Pacific Standard Time)</option>
              </select>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <Button className="bg-foreground text-background">Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSettings() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-xl font-semibold mb-6">Personal Profile</h2>
        <div className="rounded-[24px] border border-border/40 bg-card p-8 flex flex-col gap-8 shadow-sm">
          <div className="flex items-start gap-6 pb-8 border-b border-border/40">
            <div className="h-20 w-20 rounded-full bg-accent/20 flex items-center justify-center border border-border shadow-inner flex-shrink-0">
              <span className="font-bold text-2xl text-accent">JD</span>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-medium">Avatar</h3>
                <p className="text-sm text-muted-foreground mt-1">Upload a custom avatar or we'll generate one for you.</p>
              </div>
              <Button variant="outline" size="sm" className="h-9 w-fit rounded-lg">Update Avatar</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Full Name</label>
              <input type="text" defaultValue="John Doe" className="h-10 bg-secondary/30 border border-border/50 rounded-lg px-3 text-sm focus:outline-none focus:border-accent" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Email</label>
              <input type="email" defaultValue="john@orb.dev" disabled className="h-10 bg-secondary/10 border border-border/50 rounded-lg px-3 text-sm opacity-60" />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <label className="text-sm font-medium">Bio</label>
              <textarea rows={3} placeholder="A short bio about yourself..." className="bg-secondary/30 border border-border/50 rounded-lg p-3 text-sm focus:outline-none focus:border-accent resize-none"></textarea>
            </div>
          </div>
          <div className="pt-4 flex justify-end">
            <Button className="bg-foreground text-background">Update Profile</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamSettings() {
  const members = [
    { id: 1, name: "John Doe", email: "john@orb.dev", role: "Owner", status: "Active", avatar: "JD" },
    { id: 2, name: "Sarah Smith", email: "sarah@orb.dev", role: "Admin", status: "Active", avatar: "SS" },
    { id: 3, name: "Mike Johnson", email: "mike@orb.dev", role: "Developer", status: "Invited", avatar: "MJ" },
  ];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Team Members</h2>
          <Button className="h-9 rounded-lg"><Plus className="mr-2 h-4 w-4" /> Invite Member</Button>
        </div>
        
        <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden">
          <div className="p-4 border-b border-border/40 bg-secondary/10">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input type="text" placeholder="Search members..." className="w-full pl-9 pr-4 h-9 bg-background border border-border/50 rounded-lg text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/20 text-muted-foreground border-b border-border/40">
              <tr>
                <th className="px-6 py-4 font-medium">Member</th>
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-secondary/10 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent">{m.avatar}</div>
                      <div>
                        <div className="font-medium text-foreground">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select className="bg-transparent border-none text-sm focus:outline-none cursor-pointer" defaultValue={m.role}>
                      <option>Owner</option>
                      <option>Admin</option>
                      <option>Developer</option>
                      <option>Viewer</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded-full ${m.status === 'Active' ? 'bg-success/10 text-success border border-success/20' : 'bg-warning/10 text-warning border border-warning/20'}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm" className="text-muted-foreground">Manage</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SecuritySettings() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-xl font-semibold mb-6">Security & Authentication</h2>
        
        <div className="flex flex-col gap-6">
          {/* 2FA */}
          <div className="rounded-[24px] border border-border/40 bg-card p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h3 className="text-base font-semibold">Two-Factor Authentication (2FA)</h3>
              <p className="text-sm text-muted-foreground mt-1">Add an extra layer of security to your account using an authenticator app.</p>
            </div>
            <Button variant="outline" className="rounded-lg h-9">Enable 2FA</Button>
          </div>

          {/* Active Sessions */}
          <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden shadow-sm">
            <div className="p-6 border-b border-border/40">
              <h3 className="text-base font-semibold">Active Sessions</h3>
              <p className="text-sm text-muted-foreground mt-1">Devices that are currently logged into your account.</p>
            </div>
            <div className="divide-y divide-border/20">
              <div className="p-6 flex justify-between items-center bg-white/[0.01]">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center"><Monitor className="h-5 w-5 text-foreground" /></div>
                  <div>
                    <div className="font-medium text-foreground flex items-center gap-2">Windows • Chrome <span className="px-2 py-0.5 text-[10px] uppercase font-semibold rounded-full bg-success/10 text-success border border-success/20">Current</span></div>
                    <div className="text-xs text-muted-foreground mt-1">Delhi, India • IP: 192.168.1.1</div>
                  </div>
                </div>
              </div>
              <div className="p-6 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center"><Smartphone className="h-5 w-5 text-muted-foreground" /></div>
                  <div>
                    <div className="font-medium text-foreground">iPhone 14 • Safari</div>
                    <div className="text-xs text-muted-foreground mt-1">Mumbai, India • Active 2 hours ago</div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">Revoke</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiKeysSettings() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">API Keys</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage personal access tokens for the Orb API.</p>
          </div>
          <Button className="h-9 rounded-lg"><Plus className="mr-2 h-4 w-4" /> Generate Key</Button>
        </div>
        
        <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground border-b border-border/40">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Token</th>
                <th className="px-6 py-4 font-medium">Last Used</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              <tr className="hover:bg-secondary/10">
                <td className="px-6 py-4 font-medium">GitHub CI Runner</td>
                <td className="px-6 py-4 font-mono text-muted-foreground">orb_live_****************</td>
                <td className="px-6 py-4 text-muted-foreground">2 mins ago</td>
                <td className="px-6 py-4 text-right">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">Revoke</Button>
                </td>
              </tr>
              <tr className="hover:bg-secondary/10">
                <td className="px-6 py-4 font-medium">Local CLI</td>
                <td className="px-6 py-4 font-mono text-muted-foreground">orb_live_****************</td>
                <td className="px-6 py-4 text-muted-foreground">Yesterday</td>
                <td className="px-6 py-4 text-right">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">Revoke</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NotificationsSettings() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-xl font-semibold mb-6">Notification Preferences</h2>
        
        <div className="rounded-[24px] border border-border/40 bg-card overflow-hidden shadow-sm">
          <div className="p-6 border-b border-border/40 bg-secondary/10 flex justify-between items-center">
            <div>
              <h3 className="font-medium">Deployment Alerts</h3>
              <p className="text-sm text-muted-foreground mt-1">Get notified when deployments succeed or fail.</p>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center h-5 w-5 rounded border border-border bg-background group-hover:border-accent">
                <Check className="h-3.5 w-3.5 text-accent opacity-100" />
              </div>
              <span className="text-sm">Email Digest</span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center h-5 w-5 rounded border border-border bg-background group-hover:border-accent">
                <Check className="h-3.5 w-3.5 text-accent opacity-100" />
              </div>
              <span className="text-sm">Slack</span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center h-5 w-5 rounded border border-border bg-background group-hover:border-accent">
                <Check className="h-3.5 w-3.5 text-accent opacity-0" />
              </div>
              <span className="text-sm">Discord</span>
            </label>
          </div>
          
          <div className="p-6 border-t border-b border-border/40 bg-secondary/10 flex justify-between items-center">
            <div>
              <h3 className="font-medium">Billing & Account</h3>
              <p className="text-sm text-muted-foreground mt-1">Invoices, usage limits, and account changes.</p>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center h-5 w-5 rounded border border-accent bg-accent">
                <Check className="h-3.5 w-3.5 text-background opacity-100" />
              </div>
              <span className="text-sm">Email (Required)</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillingSettings() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-xl font-semibold mb-6">Billing & Usage</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Current Plan */}
          <div className="rounded-[24px] border border-border/40 bg-card p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="px-3 py-1 text-xs uppercase tracking-wider font-bold rounded-full bg-foreground text-background">Pro Plan</span>
                <span className="text-2xl font-bold">$20<span className="text-base text-muted-foreground font-normal">/mo</span></span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">You are currently on the Pro tier. Your next billing cycle starts on Aug 1, 2026.</p>
            </div>
            <Button className="w-full bg-secondary text-foreground hover:bg-secondary/80">Manage Subscription</Button>
          </div>

          {/* Payment Method */}
          <div className="rounded-[24px] border border-border/40 bg-card p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="font-medium mb-4">Payment Method</h3>
              <div className="flex items-center gap-4 p-4 rounded-[12px] border border-border/50 bg-secondary/20 mb-6">
                <div className="h-8 w-12 bg-white rounded flex items-center justify-center text-black font-bold italic text-xs">VISA</div>
                <div>
                  <div className="text-sm font-medium">•••• •••• •••• 4242</div>
                  <div className="text-xs text-muted-foreground">Expires 12/28</div>
                </div>
              </div>
            </div>
            <Button variant="outline" className="w-full">Update Method</Button>
          </div>
        </div>

        {/* Usage Metrics */}
        <div className="mt-8 rounded-[24px] border border-border/40 bg-card p-8 shadow-sm">
          <h3 className="font-medium mb-6">Current Cycle Usage</h3>
          <div className="flex flex-col gap-8">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">Bandwidth</span>
                <span className="text-muted-foreground">45 GB / 100 GB</span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-accent w-[45%] rounded-full"></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium">Build Minutes</span>
                <span className="text-muted-foreground">120m / 500m</span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-success w-[24%] rounded-full"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DangerZoneSettings() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-destructive mb-6">Danger Zone</h2>
        <div className="rounded-[24px] border border-destructive/30 bg-destructive/5 overflow-hidden">
          <div className="p-6 border-b border-destructive/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-destructive/10 transition-colors">
            <div>
              <h3 className="font-medium text-foreground">Transfer Workspace</h3>
              <p className="text-sm text-muted-foreground mt-1">Transfer ownership of this workspace to another user.</p>
            </div>
            <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10">Transfer</Button>
          </div>
          <div className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-destructive/10 transition-colors">
            <div>
              <h3 className="font-medium text-foreground">Delete Workspace</h3>
              <p className="text-sm text-muted-foreground mt-1">Permanently delete this workspace and all associated projects, domains, and data.</p>
            </div>
            <Button variant="destructive">Delete Workspace</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
