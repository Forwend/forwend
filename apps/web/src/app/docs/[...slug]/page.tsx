import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS_PAGES } from "@/screens/docs/constants/docs-content";
import { DocsScreen } from "@/screens/docs/docs-screen";
import { docsPath } from "@/shared/config/docs-routes";
import { SITE } from "@/shared/config/site";

interface DocsTopicProps {
  params: Promise<{ slug: string[] }>;
}

export function generateStaticParams() {
  return DOCS_PAGES.map((page) => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({ params }: DocsTopicProps): Promise<Metadata> {
  const { slug } = await params;
  const article = DOCS_PAGES.find((page) => page.slug === slug.join("/"));
  if (!article) notFound();
  const path = docsPath(article.slug);
  return {
    title: `${article.title} · Docs`,
    description: article.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE.name,
      url: path,
      title: article.title,
      description: article.description,
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.description,
      images: ["/opengraph-image"],
    },
  };
}

export default async function DocsTopic({ params }: DocsTopicProps) {
  const { slug } = await params;
  const article = DOCS_PAGES.find((page) => page.slug === slug.join("/"));
  if (!article) notFound();
  return <DocsScreen article={article} />;
}
