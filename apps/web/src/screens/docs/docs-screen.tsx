import { BUTTON_VARIANTS, buttonClasses, CodeBlock, Logo, ThemeSwitch } from "@forwend/ui-web";
import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS } from "@/screens/docs/constants/docs-content";
import type { DocsSection } from "@/screens/docs/types/docs";

/** Text with `backticks` around code. */
function Text({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(/`([^`]*)`/g)) {
    parts.push(text.slice(at, match.index));
    parts.push(
      <code
        key={match.index}
        className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.9em] break-words text-ink"
      >
        {match[1]}
      </code>,
    );
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return parts;
}

function Section({ section }: { section: DocsSection }) {
  return (
    <section aria-labelledby={section.id} className="flex flex-col gap-4">
      <h2 id={section.id} className="scroll-mt-6 text-2xl font-semibold tracking-tight text-ink">
        {section.title}
      </h2>
      {section.paragraphs?.map((p) => (
        <p key={p} className="text-ink">
          <Text text={p} />
        </p>
      ))}
      {section.points ? (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-ink marker:text-muted">
          {section.points.map((p) => (
            <li key={p}>
              <Text text={p} />
            </li>
          ))}
        </ul>
      ) : null}
      {section.code ? (
        <CodeBlock code={section.code.code} language={section.code.language} />
      ) : null}
    </section>
  );
}

// R-155: public, with no sign-in, so a developer can read it before making an account.
export function DocsScreen() {
  const { changelog } = DOCS;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 fw-safe-x py-8 sm:[--fw-page-gutter:2rem] sm:py-12">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" aria-label={DOCS.home} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <ThemeSwitch />
      </header>
      <main className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {DOCS.heading}
          </h1>
          <p className="text-lg text-muted">{DOCS.intro}</p>
          <nav aria-labelledby="contents" className="fw-panel px-4 py-3 sm:px-5">
            <h2 id="contents" className="text-sm font-medium text-muted">
              {DOCS.contents}
            </h2>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {[...DOCS.sections, changelog].map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`${buttonClasses({ variant: BUTTON_VARIANTS.link })} min-h-11`}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        {DOCS.sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}
        <section aria-labelledby={changelog.id} className="flex flex-col gap-4">
          <h2
            id={changelog.id}
            className="scroll-mt-6 text-2xl font-semibold tracking-tight text-ink"
          >
            {changelog.title}
          </h2>
          <p className="text-muted">{changelog.note}</p>
          <ol className="flex flex-col gap-6">
            {changelog.entries.map((entry) => (
              <li key={entry.date} className="flex flex-col gap-2">
                <time dateTime={entry.date} className="font-medium text-ink">
                  {entry.date}
                </time>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-ink marker:text-muted">
                  {entry.changes.map((c) => (
                    <li key={c}>
                      <Text text={c} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
