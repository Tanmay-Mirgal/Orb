import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Box, GitBranch, Globe, MoreVertical, Search } from "lucide-react";
import Link from "next/link";
import { getUserProjects } from "@/features/projects/actions";
import { formatDistanceToNow } from "date-fns";

export default async function ProjectsPage() {
  const projectsData = await getUserProjects();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight mb-1">Projects</h1>
          <p className="text-muted-foreground">Manage your deployments and applications.</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            className="w-full h-10 bg-secondary/30 border border-border/50 rounded-md pl-9 pr-4 text-sm focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projectsData.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No projects found. Create one to get started.
          </div>
        ) : (
          projectsData.map((data, i) => (
            <Link href={`/dashboard/projects/${data.project.name}`} key={i}>
              <Card className="group hover:border-border transition-all duration-300 cursor-pointer h-full flex flex-col hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1">
                <CardHeader className="flex flex-row items-start justify-between pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-md bg-secondary flex items-center justify-center border border-border/50">
                      <Box className="h-5 w-5 text-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{data.project.name}</CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <span className="truncate max-w-[120px]">{data.project.framework}</span>
                      </CardDescription>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 pb-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                    <GitBranch className="h-4 w-4" />
                    <span className="truncate">{data.repository?.githubRepositoryName || 'No Repo'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Globe className="h-4 w-4" />
                    <span className="truncate">{data.project.name}.orb.dev</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-4 border-t border-border/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">{formatDistanceToNow(new Date(data.project.createdAt), { addSuffix: true })}</span>
                  </div>
                  <span className="text-xs font-medium px-2 py-1 bg-secondary rounded-md border border-border/50">
                    Production
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
