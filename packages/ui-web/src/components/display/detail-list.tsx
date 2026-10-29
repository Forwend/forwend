import type { ReactNode, Ref } from "react";
import { cx } from "../../lib/cx";

export interface DetailRowProps {
  term: string;
  /** A long value (a note, an address) goes under its term instead of beside it. */
  stacked?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** One statement row: the term on the left, its value on the right, hairlines between rows. */
export function DetailRow({ term, stacked = false, children, ref }: DetailRowProps) {
  return stacked ? (
    <div ref={ref} tabIndex={ref ? -1 : undefined} className="px-4 py-2.5 outline-none sm:px-5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  ) : (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      className="flex min-h-10 items-baseline justify-between gap-4 px-4 py-2.5 outline-none sm:px-5"
    >
      <dt className="shrink-0 text-sm text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

export interface DetailListProps {
  children: ReactNode;
  className?: string;
}

export function DetailList({ children, className }: DetailListProps) {
  return <dl className={cx("divide-y divide-line", className)}>{children}</dl>;
}
