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
        className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] break-words text-ink"
      >
        {match[1]}
      </code>,
    );
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return parts;
}

// Headings sit further from the text above than from their own; scroll-mt keeps one clear of the top on a jump.
const HEADING = "scroll-mt-8 text-xl font-semibold tracking-tight text-ink sm:text-2xl";
const BULLETS = "flex list-disc flex-col gap-2 pl-5 text-ink marker:text-subtle";

function Section({ section }: { section: DocsSection }) {
  return (
    <section aria-labelledby={section.id} className="flex flex-col gap-4">
      <h2 id={section.id} className={HEADING}>
        {section.title}
      </h2>
      {section.paragraphs?.map((p) => (
        <p key={p} className="text-ink">
          <Text text={p} />
        </p>
      ))}
      {section.points ? (
        <ul className={BULLETS}>
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
// From large screens the On this page links stay in view beside the text; narrower, they follow the intro.
export function DocsScreen() {
  const { changelog } = DOCS;
  return (
    <div className="min-h-svh bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 fw-safe-x">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label={DOCS.home} className="inline-flex min-h-11 items-center">
              <Logo />
            </Link>
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <span className="truncate text-sm text-muted">{DOCS.title}</span>
          </div>
          <ThemeSwitch />
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-10 fw-safe-x pt-8 pb-16 sm:pt-12 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-x-16 lg:gap-y-12">
        <div className="flex max-w-[68ch] flex-col gap-4 lg:col-start-2">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {DOCS.heading}
          </h1>
          <p className="text-lg text-muted">{DOCS.intro}</p>
        </div>
        <nav
          aria-labelledby="contents"
          className="fw-panel px-4 py-3 sm:px-5 lg:sticky lg:top-8 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start lg:border-0 lg:bg-transparent lg:p-0"
        >
          <h2 id="contents" className="text-sm font-medium text-muted">
            {DOCS.contents}
          </h2>
          <ul className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:mt-3 lg:grid-cols-1 lg:gap-y-1">
            {[...DOCS.sections, changelog].map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={`${buttonClasses({ variant: BUTTON_VARIANTS.link })} min-h-11 text-sm lg:min-h-8`}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex max-w-[68ch] flex-col gap-14 lg:col-start-2">
          {DOCS.sections.map((section) => (
            <Section key={section.id} section={section} />
          ))}
          <section aria-labelledby={changelog.id} className="flex flex-col gap-4">
            <h2 id={changelog.id} className={HEADING}>
              {changelog.title}
            </h2>
            <p className="text-muted">{changelog.note}</p>
            <ol className="flex flex-col divide-y divide-line border-y border-line">
              {changelog.entries.map((entry) => (
                <li key={entry.date} className="flex flex-col gap-2 py-4 sm:flex-row sm:gap-6">
                  <time
                    dateTime={entry.date}
                    className="shrink-0 text-sm font-medium text-ink tabular-nums sm:w-28 sm:pt-0.5"
                  >
                    {entry.date}
                  </time>
                  <ul className={BULLETS}>
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
        </div>
      </main>
    </div>
  );
}
