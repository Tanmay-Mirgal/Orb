import { NewProjectWizard } from "@/features/projects/components/NewProjectWizard";
import { getActiveContext } from "@/features/projects/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const { org } = await getActiveContext();
  return <NewProjectWizard planId={org.plan} />;
}
