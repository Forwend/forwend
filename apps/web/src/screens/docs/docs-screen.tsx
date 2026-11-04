import { buttonClasses, CodeBlock } from "@forwend/ui-web";
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, Code2, FileText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { docsPath } from "@/shared/config/docs-routes";
import { DOCS, DOCS_PAGES, LEGACY_DOCS_ANCHORS } from "./constants/docs-content";
import styles from "./docs.module.css";
import { DocsHeader } from "./docs-header";
import { DocsLegacyLinks } from "./docs-legacy-links";
import { DocsNavigation } from "./docs-navigation";
import { buildDocsIndex } from "./lib/docs-search";
import type { DocsArticle, DocsSection } from "./types/docs";

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

function Section({ section }: { section: DocsSection }) {
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

function DocsHome() {
  return (
    <>
      <header className={styles.intro}>
        <h1>{DOCS.heading}</h1>
        <p>Accept a payment. Understand its status. Connect it to your business.</p>
      </header>
      <div className={styles.testNotice}>
        <span className={styles.testMark} aria-hidden="true" />
        <p>
          <strong>Start in test mode.</strong> The verified networks are testnets. Use test tokens,
          not real funds. <Link href={docsPath("start/test-mode")}>How test mode works</Link>
        </p>
      </div>
      <section className={styles.quickstart} aria-labelledby="quickstart-title">
        <div>
          <BookOpen aria-hidden className="size-6" />
          <h2 id="quickstart-title">One payment, from start to finish.</h2>
          <p>
            Prepare your account, create a checkout on your server, and verify your first test
            payment.
          </p>
          <Link href={docsPath("start/first-test-payment")} className={buttonClasses()}>
            Start the quickstart <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
        <ol>
          <li>
            <span>01</span>Set up your test key
          </li>
          <li>
            <span>02</span>Create a checkout
          </li>
          <li>
            <span>03</span>Pay and verify
          </li>
        </ol>
      </section>
      <section className={styles.homeSection} aria-labelledby="choose-title">
        <h2 id="choose-title">What are you building?</h2>
        <div className={styles.paths}>
          <div>
            <FileText aria-hidden className="size-5" />
            <h3>Collect without code</h3>
            <p>Invoice a client or share a link. Start from the app, with no API setup.</p>
            <Link href={docsPath("collect/invoices")}>
              Invoices <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href={docsPath("collect/payment-links")}>
              Payment links <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <div>
            <Code2 aria-hidden className="size-5" />
            <h3>Connect your checkout</h3>
            <p>Create a payment for an order. Keep its price and fulfillment on your server.</p>
            <Link href={docsPath("collect/hosted-checkout")}>
              Hosted checkout <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href={docsPath("collect/embedded-checkout")}>
              Embedded checkout <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </section>
      <section className={styles.homeSection} aria-labelledby="reference-title">
        <h2 id="reference-title">Go straight to the details</h2>
        <div className={styles.referenceLinks}>
          {[
            {
              title: "API reference",
              slug: "api/checkout-sessions",
              description: "Operations, fields and responses",
            },
            {
              title: "Payment status",
              slug: "integrate/payment-status",
              description: "Detection, confirmation and settlement",
            },
            {
              title: "Webhook verification",
              slug: "integrate/webhooks",
              description: "Signatures, retries and duplicate events",
            },
            {
              title: "Networks and tokens",
              slug: "reference/networks",
              description: "Exact test pairs and availability",
            },
          ].map((item) => (
            <Link href={docsPath(item.slug)} key={item.slug}>
              <span>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ))}
        </div>
      </section>
      <details className={styles.legacyTopics}>
        <summary>
          Looking for a previous topic link?
          <ChevronDown aria-hidden className="size-4" />
        </summary>
        <div>
          {Object.entries(LEGACY_DOCS_ANCHORS).map(([id, target]) => (
            <Link id={id} key={id} href={docsPath(target.slug, target.heading)}>
              {id.replaceAll("-", " ")} <ArrowRight aria-hidden className="size-3" />
            </Link>
          ))}
        </div>
      </details>
      <DocsLegacyLinks />
    </>
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
                <Section section={section} key={section.id} />
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
