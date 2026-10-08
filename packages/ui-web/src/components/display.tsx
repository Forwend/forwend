import { ChevronDown, Inbox } from "lucide-react";
import { PANEL_TONES } from "../constants/panel";
import { TONES } from "../constants/tone";
import { cx } from "../lib/cx";
import { TONE_CLASSES, TONE_DOT_CLASSES } from "../lib/tone";
import type {
  AccordionProps,
  BadgeProps,
  EmptyStateProps,
  NavPillProps,
  PanelProps,
  ToastProps,
} from "../types/ui/display";

export function Badge({ tone = TONES.neutral, children }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Solid surface by default. Glass only where the panel sits on imagery. */
export function Panel({ tone = PANEL_TONES.solid, className, ...props }: PanelProps) {
  return (
    <div
      className={cx(
        "rounded-lg border p-5 text-ink",
        tone === PANEL_TONES.glass
          ? "border-[color-mix(in_oklab,var(--fw-surface)_60%,transparent)] bg-glass shadow-lg backdrop-blur-glass"
          : "border-line bg-surface shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Accordion({ items }: AccordionProps) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.question} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
            {item.question}
            <ChevronDown
              aria-hidden
              className="size-[var(--fw-icon-md)] shrink-0 text-subtle transition-transform duration-[var(--fw-duration-base)] ease-out group-open:rotate-180"
            />
          </summary>
          <div className="max-w-prose pb-6 text-muted">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

export function Toast({ tone = TONES.neutral, title, description }: ToastProps) {
  return (
    <div
      role="status"
      className="flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg"
    >
      <span
        aria-hidden
        className={cx("mt-1.5 size-2 shrink-0 rounded-pill", TONE_DOT_CLASSES[tone])}
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-muted">{description}</span>
        ) : null}
      </span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("block animate-pulse rounded-md bg-surface-2", className)} />
  );
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <Inbox aria-hidden className="size-[var(--fw-icon-lg)] text-subtle" />
      <p className="mt-4 text-lg font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function NavPill({ brand, links, action }: NavPillProps) {
  return (
    <nav
      aria-label="Main"
      className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-pill border border-[color-mix(in_oklab,var(--fw-surface)_70%,transparent)] bg-glass py-1.5 pr-1.5 pl-5 shadow-md backdrop-blur-glass sm:gap-6"
    >
      <span className="font-semibold tracking-tight text-ink">{brand}</span>
      <ul className="hidden items-center gap-5 text-sm text-muted md:flex">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="transition-colors duration-[var(--fw-duration-fast)] hover:text-ink"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      {action}
    </nav>
  );
}
