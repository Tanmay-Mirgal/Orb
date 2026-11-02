import { ProjectsClient } from "@/components/dashboard/ProjectsClient";
import { getProjectCards } from "@/features/projects/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const cards = await getProjectCards();
  return <ProjectsClient cards={JSON.parse(JSON.stringify(cards))} />;
}
