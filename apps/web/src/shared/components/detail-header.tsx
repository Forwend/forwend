import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export interface DetailHeaderProps {
  /** Phones have no breadcrumb, so they get a way back to the list; a page that shows it while loading passes none. */
  back?: { href: string; label: string };
  title: ReactNode;
  /** Small badges after the title: Testnet, Test mode, a link's state. */
  badges?: ReactNode;
  /** One quiet line: how it was made, where, when. */
  meta?: ReactNode;
  /** Buttons and the More actions menu, at the title row's end. */
  actions?: ReactNode;
  /** The record's figure and states, such as the amount with its payment status. */
  summary?: ReactNode;
  /** One sentence: what happened and what to do now. */
  next?: ReactNode;
}

/** The top of every record page (payment, invoice, link, store, client, job): the same order everywhere. */
export function DetailHeader({
  back,
  title,
  badges,
  meta,
  actions,
  summary,
  next,
}: DetailHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-xl font-semibold tracking-tight text-ink">{title}</h1>
            {badges}
          </div>
          {meta ? <p className="mt-1 text-sm text-muted">{meta}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {summary ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{summary}</div>
      ) : null}
      {next ? (
        <p role="status" className="rounded-md bg-surface-2 px-4 py-3 text-sm text-ink">
          {next}
        </p>
      ) : null}
    </header>
  );
}

/** A 44px target: on phones this is the only way back. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex h-11 items-center gap-1 self-start rounded-sm px-1 text-sm text-muted hover:text-ink lg:hidden"
    >
      <ChevronLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
      {label}
    </Link>
  );
}
