import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { docsPath } from "@/shared/config/docs-routes";
import { ArticleSection } from "./article-section";
import { DOCS_PAGES } from "./constants/docs-content";
import styles from "./docs.module.css";
import { DocsHeader } from "./docs-header";
import { DocsHome } from "./docs-home";
import { DocsNavigation } from "./docs-navigation";
import { buildDocsIndex } from "./lib/docs-search";
import type { DocsArticle } from "./types/docs";

function Outline({ article }: { article: DocsArticle }) {
  return (
    <nav aria-label="On this page" className={styles.outline}>
      <p>On this page</p>
      {article.sections.map((section) => (
        <a href={`#${section.id}`} key={section.id}>
          {section.title}
        </a>
      ))}
    </nav>
  );
}

export interface DocsScreenProps {
  article?: DocsArticle;
}

export function DocsScreen({ article }: DocsScreenProps) {
  const previous = DOCS_PAGES.find((page) => page.slug === article?.previous);
  const next = DOCS_PAGES.find((page) => page.slug === article?.next);
  return (
    <div className={styles.page}>
      <a href="#docs-content" className={styles.skipLink}>
        Skip to content
      </a>
      <DocsHeader currentSlug={article?.slug} index={buildDocsIndex(DOCS_PAGES)} />
      <div className={`${styles.layout} ${!article ? styles.homeLayout : ""}`}>
        <aside className={styles.sidebar}>
          <DocsNavigation currentSlug={article?.slug} />
        </aside>
        <main id="docs-content" tabIndex={-1} className={styles.content}>
          {article ? (
            <>
              <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
                <Link href={docsPath()}>Docs</Link>
                <span aria-hidden="true">/</span>
                <span>{article.group}</span>
              </nav>
              <header className={styles.intro}>
                <h1>{article.title}</h1>
                <p>{article.description}</p>
              </header>
              <details className={styles.mobileOutline}>
                <summary>
                  On this page
                  <ChevronDown aria-hidden className="size-4" />
                </summary>
                <Outline article={article} />
              </details>
              {article.sections.map((section) => (
                <ArticleSection section={section} key={section.id} />
              ))}
              {previous || next ? (
                <nav aria-label="Guide sequence" className={styles.sequence}>
                  {previous ? (
                    <Link href={docsPath(previous.slug)}>
                      <ArrowLeft aria-hidden className="size-4" />
                      <span>
                        <small>Previous</small>
                        {previous.title}
                      </span>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {next ? (
                    <Link href={docsPath(next.slug)}>
                      <span>
                        <small>Next</small>
                        {next.title}
                      </span>
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  ) : null}
                </nav>
              ) : null}
            </>
          ) : (
            <DocsHome />
          )}
          <footer className={styles.articleFooter}>
            Forwend documentation <span>Test first. Confirm on your server.</span>
          </footer>
        </main>
        {article ? (
          <aside className={styles.rightOutline}>
            <Outline article={article} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
