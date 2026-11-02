import { getActiveContext } from "@/features/projects/actions";
import { TeamClient } from "@/features/team/TeamClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function TeamPage() {
  const { org, role, user } = await getActiveContext();
  return <TeamClient org={{ id: org.id, name: org.name, plan: org.plan, isPersonal: org.isPersonal }} role={role} currentUserId={user.id} />;
}
