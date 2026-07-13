"use server";

import { db } from "@/lib/db";
import { projects, projectRepositories } from "database";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getUserProjects() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const userProjects = await db
    .select({
      project: projects,
      repository: projectRepositories
    })
    .from(projects)
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .where(eq(projects.userId, session.user.id));

  return userProjects;
}

export async function getProjectBySlug(slug: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const projectRecord = await db
    .select({
      project: projects,
      repository: projectRepositories
    })
    .from(projects)
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!projectRecord || projectRecord.length === 0) {
    return null;
  }

  // Ensure user has access
  if (projectRecord[0].project.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  return projectRecord[0];
}
