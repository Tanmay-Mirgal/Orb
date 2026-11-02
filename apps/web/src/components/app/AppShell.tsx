"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, Bell, Box, Check, CheckCheck, ChevronsUpDown, CreditCard, Gift, Globe, GitBranch, LayoutDashboard, LogOut, Mail, Menu, Plus, Rocket, Search, Settings, Users, Wallet, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import { api } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { Kbd, Meter } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/badge";
import { Logo } from "./page";
import { CommandPalette, type PaletteProject } from "./CommandPalette";
import { ThemeToggle } from "./theme";

export interface ShellTeam {
  id: string;
  name: string;
  role: string;
  isPersonal: boolean;
}

export interface ShellProps {
  user: { name: string; email: string; image?: string | null };
  teams: ShellTeam[];
  activeTeamId: string;
  projects: PaletteProject[];
  plan: { id: string; name: string; projects: number; maxProjects: number; expiresAt: string | null; source: string };
  unreadNotifications: number;
  children: React.ReactNode;
}

const NAV = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/dashboard/projects", icon: Box },
  { label: "Domains", href: "/dashboard/domains", icon: Globe },
  { label: "Team", href: "/dashboard/team", icon: Users },
  { label: "Usage & billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

const CRUMBS: Record<string, string> = {
  projects: "Projects",
  domains: "Domains",
  team: "Team",
  billing: "Usage & billing",
  settings: "Settings",
  new: "New project",
};

function Avatar({ name, image, size = 28 }: { name: string; image?: string | null; size?: number }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} className="shrink-0 rounded-full border object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" style={{ width: size, height: size }}>
      {name.charAt(0).toUpperCase() || "U"}
    </span>
  );
}

function TeamSwitcher({ teams, activeTeamId }: { teams: ShellTeam[]; activeTeamId: string }) {
  const router = useRouter();
  const active = teams.find((t) => t.id === activeTeamId) ?? teams[0];
  const select = (id: string) => {
    document.cookie = `orb_org=${id}; path=/; max-age=31536000; samesite=lax`;
    router.push("/dashboard");
    router.refresh();
  };
  return (
    <Dropdown
      className="w-full"
      panelClassName="w-full min-w-60"
      trigger={({ toggle }) => (
        <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-secondary">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{active?.name.charAt(0).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-4">{active?.name}</span>
            <span className="block text-[11px] capitalize leading-4 text-muted-foreground">{active?.isPersonal ? "Personal" : "Team"} · {active?.role}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      )}
    >
      {(close) => (
        <>
          <DropdownLabel>Switch team</DropdownLabel>
          {teams.map((t) => (
            <DropdownItem key={t.id} onClick={() => { select(t.id); close(); }}>
              <span className="flex size-5 items-center justify-center rounded bg-secondary text-[10px] font-semibold text-foreground">{t.name.charAt(0).toUpperCase()}</span>
              <span className="flex-1 truncate">{t.name}</span>
              {t.id === activeTeamId && <Check className="!text-accent" />}
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem href="/dashboard/team" onClick={close}>
            <Plus /> Create or manage teams
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

function PlanCard({ plan, onNavigate }: { plan: ShellProps["plan"]; onNavigate?: () => void }) {
  const free = plan.id === "free";
  const expires = plan.expiresAt ? new Date(plan.expiresAt) : null;
  const days = expires ? Math.ceil((expires.getTime() - Date.now()) / 86_400_000) : null;
  const soon = !free && days !== null && days <= 7;
  return (
    <Link href="/dashboard/billing" onClick={onNavigate} className="block rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-secondary/40">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {plan.source === "grant" ? <Gift className="size-3 text-accent" /> : null}
          {plan.name} plan
        </span>
        <span className={cn(soon ? "text-warning" : "text-accent")}>{free ? "Upgrade" : soon ? "Renew" : "Manage"}</span>
      </div>
      <Meter value={plan.projects} max={plan.maxProjects} className="mt-2.5" />
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {plan.projects} of {plan.maxProjects} projects used
        {!free && expires ? ` · ${soon ? `ends in ${days}d` : plan.source === "grant" ? `free until ${expires.getFullYear()}` : `until ${expires.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}` : ""}
      </p>
    </Link>
  );
}

function SidebarContent({ props, onNavigate }: { props: ShellProps; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, plan } = props;
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-1 pt-1">
        <Logo />
      </div>
      <TeamSwitcher teams={props.teams} activeTeamId={props.activeTeamId} />

      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
        {NAV.map((item) => {
          const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <item.icon className={cn("size-4", active && "text-accent")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3">
        <PlanCard plan={plan} onNavigate={onNavigate} />

        <Dropdown
          className="w-full"
          panelClassName="bottom-full top-auto mb-1.5 mt-0 w-full min-w-56"
          trigger={({ toggle }) => (
            <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-secondary">
              <Avatar name={user.name} image={user.image} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-4">{user.name}</span>
                <span className="block truncate text-[11px] leading-4 text-muted-foreground">{user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </button>
          )}
        >
          {(close) => (
            <>
              <DropdownItem href="/dashboard/settings" onClick={() => { close(); onNavigate?.(); }}>
                <Settings /> Account settings
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                destructive
                onClick={async () => {
                  close();
                  await signOut({ fetchOptions: { onSuccess: () => router.push("/login") } });
                }}
              >
                <LogOut /> Sign out
              </DropdownItem>
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}

interface ActivityItem {
  id: string;
  status: string;
  environment: string;
  commitMessage: string | null;
  createdAt: string;
  projectName: string;
  projectSlug: string | null;
}

interface InboxItem {
  id: string;
  category: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  deployments: Rocket,
  domains: Globe,
  team: Users,
  billing: Wallet,
  security: AlertTriangle,
  product: Mail,
};

const BAD_TYPES = new Set(["deployment.failed", "service.down", "domain.error", "billing.failed"]);

function NotificationsMenu({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"inbox" | "deployments">("inbox");
  const [unread, setUnread] = React.useState(initialUnread);
  const [inbox, setInbox] = React.useState<InboxItem[] | null>(null);
  const [items, setItems] = React.useState<ActivityItem[] | null>(null);

  const loadInbox = React.useCallback(
    () =>
      api<{ notifications: InboxItem[]; unread: number }>("/api/v1/notifications?limit=20")
        .then((d) => {
          setInbox(d.notifications);
          setUnread(d.unread);
        })
        .catch(() => setInbox([])),
    [],
  );

  // Keep the badge fresh while the tab is visible (one tiny query per minute per open dashboard).
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        void api<{ unread: number }>("/api/v1/notifications?limit=1").then((d) => setUnread(d.unread)).catch(() => undefined);
      }
    };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    await api("/api/v1/notifications/read", { method: "POST", body: JSON.stringify(body) }).catch(() => undefined);
    void loadInbox();
  };

  return (
    <Dropdown
      align="end"
      panelClassName="w-[22rem] max-w-[calc(100vw-1.5rem)]"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          onClick={() => {
            toggle();
            void loadInbox();
            void api<{ activity: ActivityItem[] }>("/api/v1/activity").then((d) => setItems(d.activity)).catch(() => setItems([]));
          }}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-foreground ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-1 px-1.5 pb-1 pt-1">
            {(["inbox", "deployments"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors", tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t === "inbox" ? `Inbox${unread ? ` · ${unread}` : ""}` : "Deployments"}
              </button>
            ))}
            {tab === "inbox" && unread > 0 && (
              <button onClick={() => void markRead({ all: true })} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="scroll-thin max-h-96 overflow-y-auto border-t">
            {tab === "inbox" ? (
              <>
                {inbox === null && <p className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</p>}
                {inbox?.length === 0 && (
                  <div className="px-3 py-10 text-center">
                    <Bell className="mx-auto size-5 text-muted-foreground/60" />
                    <p className="mt-2 text-[13px] font-medium">You are all caught up</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Deployments, invitations and billing updates show up here.</p>
                  </div>
                )}
                {inbox?.map((n) => {
                  const Icon = CATEGORY_ICON[n.category] ?? Bell;
                  const bad = BAD_TYPES.has(n.type);
                  return (
                    <DropdownItem
                      key={n.id}
                      href={n.href ?? undefined}
                      onClick={() => {
                        if (!n.readAt) void markRead({ ids: [n.id] });
                        close();
                        if (!n.href) router.refresh();
                      }}
                    >
                      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", bad ? "bg-destructive/10" : "bg-secondary")}>
                        <Icon className={cn("!size-3.5", bad && "!text-destructive")} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className={cn("text-[13px] leading-snug", n.readAt ? "font-normal" : "font-semibold")}>{n.title}</span>
                          {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                        </div>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                        <p className="mt-1 text-[11px] text-muted-foreground/80">{timeAgo(n.createdAt)}</p>
                      </div>
                    </DropdownItem>
                  );
                })}
              </>
            ) : (
              <>
                {items === null && <p className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</p>}
                {items?.length === 0 && <p className="px-3 py-8 text-center text-xs text-muted-foreground">Nothing deployed yet.</p>}
                {items?.map((a) => (
                  <DropdownItem key={a.id} href={`/dashboard/projects/${a.projectSlug ?? ""}`} onClick={close}>
                    <GitBranch className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{a.projectName}</span>
                        <StatusBadge status={a.status} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.commitMessage ?? "Manual deployment"} · {timeAgo(a.createdAt)}</p>
                    </div>
                  </DropdownItem>
                ))}
              </>
            )}
          </div>
          <div className="border-t px-0 pt-1">
            <DropdownItem href="/dashboard/settings" onClick={close}>
              <Settings /> Notification settings
            </DropdownItem>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean).slice(1); // drop "dashboard"
  if (parts.length === 0) return <span className="text-sm font-medium">Overview</span>;
  const crumbs = parts.map((p, i) => ({
    label: i === 0 ? (CRUMBS[p] ?? p) : (CRUMBS[p] ?? decodeURIComponent(p)),
    href: "/dashboard/" + parts.slice(0, i + 1).join("/"),
  }));
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link href="/dashboard" className="hidden text-muted-foreground hover:text-foreground sm:inline">Dashboard</Link>
      {crumbs.map((c, i) => (
        <React.Fragment key={c.href}>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          {i === crumbs.length - 1 ? (
            <span className="truncate font-medium">{c.label}</span>
          ) : (
            <Link href={c.href} className="text-muted-foreground hover:text-foreground">{c.label}</Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function AppShell(props: ShellProps) {
  const [drawer, setDrawer] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => setDrawer(false), [pathname]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[300] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-background lg:block">
        <SidebarContent props={props} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="animate-pop absolute inset-y-0 left-0 w-72 border-r bg-background shadow-lg">
            <Button variant="ghost" size="icon-sm" className="absolute right-2 top-3" onClick={() => setDrawer(false)} aria-label="Close menu">
              <X />
            </Button>
            <SidebarContent props={props} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <button
            onClick={() => setPalette(true)}
            className="hidden h-9 w-60 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] text-muted-foreground shadow-sm transition-colors hover:bg-secondary md:flex"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setPalette(true)} aria-label="Search">
            <Search />
          </Button>
          <NotificationsMenu initialUnread={props.unreadNotifications} />
          <ThemeToggle />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/dashboard/new">
              <Plus /> New project
            </Link>
          </Button>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          {props.children}
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} projects={props.projects} />
    </div>
  );
}

