import { ORG_PLANS } from "shared";
import { FAQ, TOUR_VIDEO } from "../features/landing/data";
import { AUTHOR, HOME_DESCRIPTION, SITE_NAME, absoluteUrl } from "./site";

/** schema.org graph for the home page. Everything here is also visible on the page (Google requires that). */
export function homeJsonLd() {
  const org = absoluteUrl("/#organization");
  const site = absoluteUrl("/#website");
  const app = absoluteUrl("/#software");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": org,
        name: SITE_NAME,
        url: absoluteUrl("/"),
        logo: { "@type": "ImageObject", url: absoluteUrl("/logo.png"), width: 790, height: 636 },
        founder: { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url },
      },
      {
        "@type": "WebSite",
        "@id": site,
        url: absoluteUrl("/"),
        name: SITE_NAME,
        description: HOME_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": org },
      },
      {
        "@type": "SoftwareApplication",
        "@id": app,
        name: SITE_NAME,
        url: absoluteUrl("/"),
        description: HOME_DESCRIPTION,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Deployment platform",
        operatingSystem: "Web",
        publisher: { "@id": org },
        featureList: [
          "Git-driven deploys from GitHub",
          "Static sites, web services, background workers and cron jobs",
          "Instant rollbacks and zero-downtime releases",
          "Custom domains with automatic HTTPS",
          "Encrypted environment variables",
          "Live logs and analytics",
          "Teams with invitations and roles",
          "E-mail and in-app notifications",
        ],
        offers: Object.values(ORG_PLANS).map((p) => ({
          "@type": "Offer",
          name: `${p.name} plan`,
          price: String(p.priceInrMonth),
          priceCurrency: "INR",
          description: p.priceInrMonth === 0 ? "Free forever" : "Per month, prepaid",
          url: absoluteUrl("/#pricing"),
          availability: "https://schema.org/InStock",
        })),
      },
      {
        "@type": "VideoObject",
        name: TOUR_VIDEO.name,
        description: TOUR_VIDEO.description,
        thumbnailUrl: absoluteUrl(TOUR_VIDEO.poster),
        contentUrl: absoluteUrl(TOUR_VIDEO.src),
        uploadDate: TOUR_VIDEO.uploadDate,
        duration: TOUR_VIDEO.durationIso,
        publisher: { "@id": org },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
  };
}

/** JSON for an inline <script type="application/ld+json">: `<` is escaped so no value can close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
