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
  /** A tile before the title that says what kind of record it is. */
  icon?: ReactNode;
  /** The one figure the record is about, beside the actions: an amount due, a total. */
  figure?: { label: string; value: ReactNode };
  /** Buttons and the More actions menu, at the title row's end. */
  actions?: ReactNode;
  /** The record's figure and states, such as the amount with its payment status. */
  summary?: ReactNode;
}

/** The top of every record page (payment, invoice, link, store, client, job): the same order everywhere. */
export function DetailHeader({
  back,
  title,
  badges,
  meta,
  icon,
  figure,
  actions,
  summary,
}: DetailHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted [&_svg]:size-[var(--fw-icon-md)]">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-semibold tracking-tight text-ink">{title}</h1>
              {badges}
            </div>
            {meta ? <p className="mt-1 text-sm text-muted">{meta}</p> : null}
          </div>
        </div>
        {figure || actions ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {figure ? (
              <p className="flex items-baseline gap-2">
                <span className="text-sm text-muted">{figure.label}</span>
                <span className="text-2xl font-medium tracking-tight text-ink tabular-nums">
                  {figure.value}
                </span>
              </p>
            ) : null}
            {figure && actions ? (
              <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />
            ) : null}
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
      </div>
      {summary ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{summary}</div>
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
