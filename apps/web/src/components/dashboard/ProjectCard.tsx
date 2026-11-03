import Link from "next/link";
import { Box, Clock, Code2, Container, GitBranch, Globe, Server, Timer, Cog } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { GithubIcon } from "@/components/app/page";
import { hostOf, projectUrl, timeAgo, TYPE_LABEL } from "@/lib/format";

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  static: Globe,
  web_service: Server,
  worker: Cog,
  cron: Timer,
};

export interface ProjectCardData {
  project: { id: string; name: string; slug: string | null; type: string; framework: string | null; sourceType?: string; dockerImage?: string | null };
  repository: { githubRepositoryName: string; branch: string } | null;
  current: { status: string; readyAt: string | null; createdAt: string; commitMessage: string | null } | null;
  latest: { status: string; createdAt: string; commitMessage: string | null } | null;
}

export function ProjectCard({ data }: { data: ProjectCardData }) {
  const { project, repository, current, latest } = data;
  const Icon = TYPE_ICON[project.type] ?? Box;
  const status = latest?.status ?? null;
  const url = projectUrl(project.slug);
  return (
    <Link
      href={`/dashboard/projects/${project.slug ?? project.id}`}
      className="group flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-secondary">
            <Icon className="size-5 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold tracking-tight group-hover:text-accent">{project.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{current ? hostOf(url) : "Not deployed yet"}</p>
          </div>
        </div>
        {status ? <StatusBadge status={status} /> : <Badge>New</Badge>}
      </div>

      <p className="line-clamp-1 min-h-5 text-[13px] text-muted-foreground">{latest?.commitMessage ?? (project.sourceType === "image" ? "Deploy to pull the image and see activity here." : "Connect a repository and deploy to see activity here.")}</p>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground">
        {project.sourceType === "image" && project.dockerImage && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Container className="size-3.5 shrink-0" />
            <span className="truncate font-mono">{project.dockerImage}</span>
          </span>
        )}
        {repository && (
          <span className="flex min-w-0 items-center gap-1.5">
            <GithubIcon className="size-3.5 shrink-0" />
            <span className="truncate">{repository.githubRepositoryName}</span>
          </span>
        )}
        {repository && (
          <span className="flex items-center gap-1.5">
            <GitBranch className="size-3.5" /> {repository.branch}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Code2 className="size-3.5" /> {project.framework || TYPE_LABEL[project.type]}
        </span>
        {latest && (
          <span className="ml-auto flex items-center gap-1.5">
            <Clock className="size-3.5" /> {timeAgo(latest.createdAt)}
          </span>
        )}
      </div>
    </Link>
  );
}
