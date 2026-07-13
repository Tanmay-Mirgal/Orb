"use server";

import { getUserProjects } from "@/features/projects/actions";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { DashboardContentClient } from "@/components/dashboard/DashboardContentClient";

export default async function DashboardHome() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const userName = session?.user?.name || "Developer";
  const projectsData = await getUserProjects();
  
  return <DashboardContentClient projectsData={projectsData} userName={userName} />;
}
