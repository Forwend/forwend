import type { Metadata } from "next";
import { DOCS } from "@/screens/docs/constants/docs-content";
import { DocsScreen } from "@/screens/docs/docs-screen";
import { docsPath } from "@/shared/config/docs-routes";
import { SITE } from "@/shared/config/site";

export const metadata: Metadata = {
  title: DOCS.title,
  description: DOCS.description,
  alternates: { canonical: docsPath() },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    url: docsPath(),
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
