import type { MetadataRoute } from "next";
import { HOME_DESCRIPTION } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Orb — deployment platform",
    short_name: "Orb",
    description: HOME_DESCRIPTION,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#08080a",
    theme_color: "#08080a",
    categories: ["developer tools", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
