"use server";

import { cookies, headers } from "next/headers";
import { and, desc, eq, memberships, organizations, projectRepositories, projects } from "database";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ORG_COOKIE, resolveActiveOrg } from "@/server/orgs";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user;
}

/** The signed-in user plus their active team (from the `orb_org` cookie, else the personal team). */
export async function getActiveContext() {
  const user = await requireUser();
  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const active = await resolveActiveOrg({ id: user.id, name: user.name }, preferred);
  return {
    user,
    org: active.org,
    role: active.role,
    teams: active.all.map((m) => ({ id: m.org.id, name: m.org.name, slug: m.org.slug, plan: m.org.plan, role: m.role, isPersonal: m.org.isPersonal })),
  };
}

/** Projects of the active team, in the `{ project, repository }` shape the list components expect. */
export async function getUserProjects() {
  const { org } = await getActiveContext();
  return db
    .select({ project: projects, repository: projectRepositories })
    .from(projects)
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .where(eq(projects.orgId, org.id))
    .orderBy(desc(projects.createdAt));
}

/** A project by slug, provided the user belongs to the team that owns it (any of their teams). */
export async function getProjectBySlug(slug: string) {
  const user = await requireUser();
  const [row] = await db
    .select({ project: projects, repository: projectRepositories, org: organizations, role: memberships.role })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(memberships, and(eq(memberships.orgId, projects.orgId), eq(memberships.userId, user.id)))
    .leftJoin(projectRepositories, eq(projects.id, projectRepositories.projectId))
    .where(eq(projects.slug, slug))
    .limit(1);
  return row ?? null;
}
