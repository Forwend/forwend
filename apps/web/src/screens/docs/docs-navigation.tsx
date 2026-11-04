import Link from "next/link";
import { docsPath } from "@/shared/config/docs-routes";
import { DOCS_GROUPS, DOCS_PAGES } from "./constants/docs-content";
import styles from "./docs.module.css";

export interface DocsNavigationProps {
  currentSlug?: string;
  onNavigate?: () => void;
}

export function DocsNavigation({ currentSlug, onNavigate }: DocsNavigationProps) {
  return (
    <nav aria-label="Documentation" className={styles.navigation}>
      <Link href={docsPath()} aria-current={!currentSlug ? "page" : undefined} onClick={onNavigate}>
        Overview
      </Link>
      {DOCS_GROUPS.map((group) => (
        <div key={group} className={styles.navGroup}>
          <h2>{group}</h2>
          {DOCS_PAGES.filter((page) => page.group === group).map((page) => (
            <Link
              key={page.slug}
              href={docsPath(page.slug)}
              aria-current={currentSlug === page.slug ? "page" : undefined}
              onClick={onNavigate}
            >
              {page.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
