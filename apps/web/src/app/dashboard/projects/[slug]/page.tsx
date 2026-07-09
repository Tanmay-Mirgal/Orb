import { getProjectByName } from "@/features/projects/actions";
import { notFound } from "next/navigation";
import { ProjectDetailsClient } from "@/features/projects/components/ProjectDetailsClient";

export default async function ProjectDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const projectData = await getProjectByName(resolvedParams.slug);

  if (!projectData) {
    notFound();
  }

  return (
    <ProjectDetailsClient 
      project={projectData.project} 
      repository={projectData.repository} 
    />
  );
}
