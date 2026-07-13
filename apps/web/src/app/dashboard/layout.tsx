import { UserProfile } from "@/components/UserProfile";
import { SidebarLayout } from "@/components/dashboard/SidebarLayout";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout userProfile={<UserProfile />}>
      {children}
    </SidebarLayout>
  );
}
