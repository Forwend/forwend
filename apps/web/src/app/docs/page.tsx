import type { Metadata } from "next";
import { DOCS } from "@/screens/docs/constants/docs-content";
import { DocsScreen } from "@/screens/docs/docs-screen";
import { SITE } from "@/shared/config/site";

export const metadata: Metadata = {
  title: DOCS.title,
  description: DOCS.description,
  alternates: { canonical: "/docs" },
  // Its own share card, with the site's image: a page's openGraph replaces the root's whole object.
  openGraph: {
    type: "website",
    siteName: SITE.name,
    url: "/docs",
    title: DOCS.heading,
    description: DOCS.description,
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: DOCS.heading,
    description: DOCS.description,
    images: ["/opengraph-image"],
  },
};

export default function DocsPage() {
  return <DocsScreen />;
}
