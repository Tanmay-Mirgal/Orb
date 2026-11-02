"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Box, CornerDownLeft, CreditCard, Globe, LayoutDashboard, Moon, Plus, Search, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/feedback";
import { useTheme } from "./theme";

export interface PaletteProject {
  id: string;
  name: string;
  slug: string | null;
  type: string;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
  group: "Actions" | "Navigate" | "Projects";
}

/** ⌘K / Ctrl+K launcher: jump to any page or project, or run common actions, without touching the mouse. */
export function CommandPalette({
  open,
  onClose,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projects: PaletteProject[];
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const go = React.useCallback(
    (href: string) => () => {
      router.push(href);
      onClose();
    },
    [router, onClose],
  );

  const commands = React.useMemo<Command[]>(
    () => [
      { id: "new", label: "Create new project", icon: Plus, run: go("/dashboard/new"), group: "Actions" },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: Moon,
        run: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          onClose();
        },
        group: "Actions",
      },
      { id: "overview", label: "Overview", icon: LayoutDashboard, run: go("/dashboard"), group: "Navigate" },
      { id: "projects", label: "Projects", icon: Box, run: go("/dashboard/projects"), group: "Navigate" },
      { id: "domains", label: "Domains", icon: Globe, run: go("/dashboard/domains"), group: "Navigate" },
      { id: "team", label: "Team & members", icon: Users, run: go("/dashboard/team"), group: "Navigate" },
      { id: "billing", label: "Usage & billing", icon: CreditCard, run: go("/dashboard/billing"), group: "Navigate" },
      { id: "settings", label: "Settings & API tokens", icon: Settings, run: go("/dashboard/settings"), group: "Navigate" },
      ...projects.map<Command>((p) => ({
        id: `p-${p.id}`,
        label: p.name,
        hint: p.slug ?? undefined,
        icon: Box,
        run: go(`/dashboard/projects/${p.slug ?? p.id}`),
        group: "Projects",
      })),
    ],
    [go, onClose, projects, setTheme, theme],
  );

  const q = query.trim().toLowerCase();
  const results = q ? commands.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q)) : commands.slice(0, 12);

  React.useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[12vh]" role="presentation">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="animate-pop relative w-full max-w-xl overflow-hidden rounded-2xl border bg-popover shadow-lg" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, pages and actions…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="scroll-thin max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query}”.</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <React.Fragment key={c.id}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{header}</div>}
                <button
                  onClick={c.run}
                  onMouseMove={() => setActive(i)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm", i === active ? "bg-secondary" : "")}
                >
                  <c.icon className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="truncate font-mono text-xs text-muted-foreground">{c.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
