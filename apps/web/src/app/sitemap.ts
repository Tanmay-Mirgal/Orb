import type { MetadataRoute } from "next";
import { TOUR_VIDEO } from "@/features/landing/data";
import { absoluteUrl } from "@/lib/site";

/** Only pages worth ranking: the dashboard, login and invite links are private or noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
      images: [absoluteUrl("/opengraph-image"), absoluteUrl(TOUR_VIDEO.poster)],
      videos: [
        {
          title: TOUR_VIDEO.name,
          description: TOUR_VIDEO.description,
          thumbnail_loc: absoluteUrl(TOUR_VIDEO.poster),
          content_loc: absoluteUrl(TOUR_VIDEO.src),
          duration: 55,
          publication_date: TOUR_VIDEO.uploadDate,
        },
      ],
    },
  ];
}
