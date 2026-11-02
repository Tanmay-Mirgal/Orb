/**
 * Single source of truth for everything a search engine or a link preview reads about the site.
 * The public URL comes from NEXT_PUBLIC_APP_URL; a localhost value (local development) is never published
 * in canonical links, the sitemap or structured data, so a dev build cannot leak into search results.
 */
const FALLBACK_URL = "https://orb.tanmaymirgal.dev";

function resolveSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw || /localhost|127\.0\.0\.1|\[::1\]/.test(raw)) return FALLBACK_URL;
  return raw.replace(/\/+$/, "");
}

export const SITE_URL = resolveSiteUrl();
export const SITE_NAME = "Orb";

/** <title> of the home page (≤ 60 characters so it is not cut off in results). */
export const HOME_TITLE = "Orb — Deploy sites, services & cron jobs from git push";
export const HOME_DESCRIPTION =
  "Push to GitHub and go live: Orb deploys static sites, web services, workers and cron jobs with free HTTPS, custom domains, rollbacks, teams and alerts. Free plan.";
export const SOCIAL_TITLE = "Orb — From git push to production, in seconds";

export const KEYWORDS = [
  "deployment platform",
  "deploy from GitHub",
  "git push deploy",
  "Vercel alternative",
  "Render alternative",
  "Next.js hosting",
  "static site hosting",
  "deploy Docker containers",
  "cron job hosting",
  "background workers",
  "custom domain HTTPS",
  "instant rollbacks",
  "preview deployments",
  "self-hosted PaaS",
  "free app hosting India",
];

export const AUTHOR = { name: "Tanmay Mirgal", url: "https://tanmaymirgal.dev" };

export const absoluteUrl = (path = "/") => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
