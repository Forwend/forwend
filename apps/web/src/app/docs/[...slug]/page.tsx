import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS_PAGES } from "@/screens/docs/constants/docs-content";
import { DocsScreen } from "@/screens/docs/docs-screen";
import { docsMetadata } from "@/screens/docs/lib/docs-metadata";
import { docsPath } from "@/shared/config/docs-routes";

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
  return docsMetadata({
    title: `${article.title} · Docs`,
    heading: article.title,
    description: article.description,
    path: docsPath(article.slug),
  });
}

export default async function DocsTopic({ params }: DocsTopicProps) {
  const { slug } = await params;
  const article = DOCS_PAGES.find((page) => page.slug === slug.join("/"));
  if (!article) notFound();
  return <DocsScreen article={article} />;
}
