"use server";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Box, Clock, Globe } from "lucide-react";
import { getUserProjects } from "@/features/projects/actions";
import Link from "next/link";
import { DashboardCharts } from "@/features/dashboard/components/DashboardCharts";
import { formatDistanceToNow } from "date-fns";

export default async function DashboardHome() {
  const projectsData = await getUserProjects();
  
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Overview</h1>
        <p className="text-muted-foreground">Welcome back. Here is what is happening across your workspace.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Total Projects", value: projectsData.length.toString(), icon: Box, description: "Active projects" },
          { title: "Total Deployments", value: "0", icon: Activity, description: "Total deployments" },
          { title: "Active Domains", value: projectsData.length.toString(), icon: Globe, description: "All SSL verified" },
          { title: "Build Minutes", value: "0", icon: Clock, description: "Of 10,000 included" }
        ].map((stat, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="col-span-1 lg:col-span-2">
          <DashboardCharts />
        </div>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Projects</CardTitle>
            <CardDescription>Your configured projects.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {projectsData.length === 0 ? (
                <div className="text-sm text-muted-foreground">No projects found.</div>
              ) : (
                projectsData.map((data, i) => (
                  <Link key={i} href={`/dashboard/projects/${data.project.name}`} className="flex items-center justify-between hover:bg-secondary/20 p-2 rounded-md transition-colors cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{data.project.name}</span>
                      <span className="text-xs text-muted-foreground">{data.repository?.githubRepositoryName || 'No Repo'} • {formatDistanceToNow(new Date(data.project.createdAt), { addSuffix: true })}</span>
                    </div>
                    <div className="px-2 py-1 text-xs font-medium rounded-full bg-success/10 text-success border border-success/20">
                      Ready
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
