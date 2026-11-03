"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page";
import { NoProjects } from "./OverviewClient";
import { ProjectCard, type ProjectCardData } from "./ProjectCard";

type Filter = "all" | "static" | "web_service" | "worker" | "cron";

export function ProjectsClient({ cards }: { cards: ProjectCardData[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (filter === "all" || c.project.type === filter) &&
        (!q || c.project.name.toLowerCase().includes(q) || (c.repository?.githubRepositoryName ?? "").toLowerCase().includes(q) || (c.project.dockerImage ?? "").toLowerCase().includes(q)),
    );
  }, [cards, query, filter]);

  const present = (t: Filter) => t === "all" || cards.some((c) => c.project.type === t);
  const options = ([
    { id: "all", label: "All" },
    { id: "static", label: "Static" },
    { id: "web_service", label: "Services" },
    { id: "worker", label: "Workers" },
    { id: "cron", label: "Cron" },
  ] as Array<{ id: Filter; label: string }>).filter((o) => present(o.id));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title="Projects"
        description={`${cards.length} project${cards.length === 1 ? "" : "s"} in this team`}
        actions={
          <Button asChild>
            <Link href="/dashboard/new">
              <Plus /> New project
            </Link>
          </Button>
        }
      />

      {cards.length === 0 ? (
        <NoProjects />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by name, repository or image…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
            </div>
            {options.length > 2 && <Segmented options={options} value={filter} onChange={setFilter} />}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed py-14 text-center text-sm text-muted-foreground">No projects match your filters.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((c) => (
                <ProjectCard key={c.project.id} data={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
