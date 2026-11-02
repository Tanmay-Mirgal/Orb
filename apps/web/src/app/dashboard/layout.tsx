import { AppShell } from "@/components/app/AppShell";
import { getShellData } from "@/features/projects/actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const shell = await getShellData();
  return <AppShell {...shell}>{children}</AppShell>;
}
