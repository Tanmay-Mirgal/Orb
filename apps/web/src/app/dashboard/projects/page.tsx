import { getUserProjects } from "@/features/projects/actions";
import { ProjectsContentClient } from "@/components/dashboard/ProjectsContentClient";

export default async function ProjectsPage() {
  const projectsData = await getUserProjects();

  return <ProjectsContentClient projectsData={projectsData} />;
}
