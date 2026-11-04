import { docsPath } from "@/shared/config/docs-routes";
import type { DocsArticle, DocsSearchEntry } from "../types/docs";

export function buildDocsIndex(pages: readonly DocsArticle[]): DocsSearchEntry[] {
  return pages.flatMap((page) => [
    { title: page.title, section: page.group, text: page.description, href: docsPath(page.slug) },
    ...page.sections.map((section) => ({
      title: page.title,
      section: section.title,
      text: [
        section.path,
        section.scope,
        ...(section.paragraphs ?? []),
        ...(section.points ?? []),
        ...(section.fields?.map((field) => `${field.name} ${field.type} ${field.description}`) ??
          []),
        section.code?.code,
      ]
        .filter(Boolean)
        .join(" "),
      href: docsPath(page.slug, section.id),
    })),
  ]);
}

export function searchDocs(index: readonly DocsSearchEntry[], query: string): DocsSearchEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .filter((entry) => {
      const text = `${entry.title} ${entry.section} ${entry.text}`.toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => {
      const rank = (entry: DocsSearchEntry) =>
        words.reduce(
          (sum, word) =>
            sum +
            (entry.title.toLocaleLowerCase().includes(word) ? 2 : 0) +
            (entry.section.toLocaleLowerCase().includes(word) ? 1 : 0),
          0,
        );
      return rank(b) - rank(a);
    })
    .slice(0, 20)
    .map((entry) => {
      const first = entry.text.toLocaleLowerCase().indexOf(words[0] ?? "");
      const start = Math.max(0, first - 45);
      const excerpt = entry.text.slice(start, start + 180);
      return {
        ...entry,
        text: `${start ? "…" : ""}${excerpt}${entry.text.length > start + 180 ? "…" : ""}`,
      };
    });
}
