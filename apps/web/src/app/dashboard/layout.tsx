import { UserProfile } from "@/components/UserProfile";
import { SidebarLayout } from "@/components/dashboard/SidebarLayout";
import { getActiveContext } from "@/features/projects/actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { org, teams } = await getActiveContext();
  return (
    <SidebarLayout userProfile={<UserProfile />} teams={teams} activeTeamId={org.id}>
      {children}
    </SidebarLayout>
  );
}
