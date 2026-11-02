import { notFound } from "next/navigation";
import { getProjectBySlug } from "@/features/projects/actions";
import { ProjectDetailsClient } from "@/features/projects/components/ProjectDetailsClient";

export const dynamic = "force-dynamic";

export default async function ProjectDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getProjectBySlug(slug);
  if (!data) notFound();

  return <ProjectDetailsClient project={data.project} repository={data.repository} role={data.role} />;
}
