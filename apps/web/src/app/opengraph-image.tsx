import { renderSocialCard } from "@/lib/og";

export const alt = "Orb — from git push to production, in seconds. Deploy static sites, web services, workers and cron jobs.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderSocialCard();
}
