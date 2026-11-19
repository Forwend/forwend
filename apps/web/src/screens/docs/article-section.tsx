import { CodeBlock } from "@forwend/ui-web";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { docsPath } from "@/shared/config/docs-routes";
import styles from "./docs.module.css";
import type { DocsSection } from "./types/docs";

function Text({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(/`([^`]*)`/g)) {
    parts.push(text.slice(at, match.index));
    parts.push(<code key={match.index}>{match[1]}</code>);
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return parts;
}

export function ArticleSection({ section }: { section: DocsSection }) {
  return (
    <section aria-labelledby={section.id} className={styles.section}>
      <h2 id={section.id}>
        <a href={`#${section.id}`}>
          {section.title}
          <span aria-hidden="true">#</span>
        </a>
      </h2>
      {section.method && section.path ? (
        <div className={styles.endpoint}>
          <span>{section.method}</span>
          <code>{section.path}</code>
        </div>
      ) : null}
      {section.scope ? (
        <p className={styles.scope}>
          Authentication: Bearer key · Required scope: <code>{section.scope}</code>
        </p>
      ) : null}
      {section.paragraphs?.map((text) => (
        <p key={text}>
          <Text text={text} />
        </p>
      ))}
      {section.points ? (
        <ul>
          {section.points.map((text) => (
            <li key={text}>
              <Text text={text} />
            </li>
          ))}
        </ul>
      ) : null}
      {section.fields ? (
        <div className={styles.tableScroll}>
          <table>
            <caption className={section.fieldLabel ? undefined : "sr-only"}>
              {section.fieldLabel ?? section.title}
            </caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {section.fields.map((field) => (
                <tr key={field.name}>
                  <th scope="row">
                    <code>{field.name}</code>
                    <span>{field.type}</span>
                  </th>
                  <td>{field.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {section.code ? (
        <div className={styles.code}>
          <CodeBlock code={section.code.code} language={section.code.language} />
        </div>
      ) : null}
      {section.links ? (
        <div className={styles.relatedLinks}>
          {section.links.map((link) => (
            <Link key={link.slug} href={docsPath(link.slug)}>
              {link.label}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
