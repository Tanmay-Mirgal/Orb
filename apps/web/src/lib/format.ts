import { formatDistanceToNowStrict } from "date-fns";

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Date.now() - d.getTime() < 45_000) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
}

export const TYPE_LABEL: Record<string, string> = {
  static: "Static Site",
  web_service: "Web Service",
  worker: "Background Worker",
  cron: "Cron Job",
};

/** Public URL of a project's production alias. */
export function projectUrl(slug: string | null | undefined): string {
  const base = process.env.NEXT_PUBLIC_BASE_DOMAIN || "localhost";
  const local = base === "localhost";
  return `${local ? "http" : "https"}://${slug ?? ""}.${base}${local ? ":8000" : ""}`;
}

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
