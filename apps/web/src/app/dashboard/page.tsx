import { OverviewClient } from "@/components/dashboard/OverviewClient";
import { getOverview } from "@/features/projects/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function DashboardHome() {
  const data = await getOverview();
  return <OverviewClient data={JSON.parse(JSON.stringify(data))} />;
}
