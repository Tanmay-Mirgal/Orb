import { AppShell } from "@/components/app/AppShell";
import { getShellData } from "@/features/projects/actions";

import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const shell = await getShellData();
  return <AppShell {...shell}>{children}</AppShell>;
}
