import { notFound } from "next/navigation";
import { connectorEnabled, connectorHubName } from "core";
import { getProjectBySlug } from "@/features/projects/actions";
import { ProjectDetailsClient } from "@/features/projects/components/ProjectDetailsClient";
import { ConnectorHubProvider } from "@/features/projects/components/ViaHub";

export const dynamic = "force-dynamic";

export default async function ProjectDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getProjectBySlug(slug);
  if (!data) notFound();

  return (
    <ConnectorHubProvider hub={connectorEnabled() ? connectorHubName() : null}>
      <ProjectDetailsClient project={data.project} repository={data.repository} role={data.role} registryLogin={data.registryUsername && data.registryHost ? { username: data.registryUsername, host: data.registryHost } : null} />
    </ConnectorHubProvider>
  );
}
