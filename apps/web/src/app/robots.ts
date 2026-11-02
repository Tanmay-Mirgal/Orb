import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Public marketing page and its media are crawlable. The app itself (behind a login), the API and one-time
 * invitation links are not. /login stays crawlable on purpose: it carries `noindex`, which crawlers can only
 * honour if they are allowed to fetch the page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/media/"], disallow: ["/dashboard", "/api/", "/invite/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
