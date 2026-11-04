import type { MetadataRoute } from "next";
import { DOCS_PAGES } from "@/screens/docs/constants/docs-content";
import { docsPath } from "@/shared/config/docs-routes";
import { SITE } from "@/shared/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}${docsPath()}`, changeFrequency: "weekly", priority: 0.8 },
    ...DOCS_PAGES.map((page) => ({
      url: `${SITE.url}${docsPath(page.slug)}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
