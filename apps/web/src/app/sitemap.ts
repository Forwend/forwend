import type { MetadataRoute } from "next";
import { SITE } from "@/shared/config/site";

// Public pages only; /kit is private.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/docs`, changeFrequency: "weekly", priority: 0.8 },
  ];
}
