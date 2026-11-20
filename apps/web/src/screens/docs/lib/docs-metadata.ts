import type { Metadata } from "next";
import { SITE } from "@/shared/config/site";

export function docsMetadata(page: {
  title: string;
  heading: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      type: "website",
      siteName: SITE.name,
      url: page.path,
      title: page.heading,
      description: page.description,
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: page.heading,
      description: page.description,
      images: ["/opengraph-image"],
    },
  };
}
