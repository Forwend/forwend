import type { MetadataRoute } from "next";
import { SITE } from "@/shared/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/kit" },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
