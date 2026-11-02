import { BillingClient } from "@/features/billing/BillingClient";
import { getUsage } from "@/features/projects/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage & billing" };

export default async function BillingPage() {
  const data = await getUsage();
  return <BillingClient data={data} />;
}
