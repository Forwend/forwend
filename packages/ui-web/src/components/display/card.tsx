import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export interface CardProps {
  /** Names the card for screen readers; the heading's id. */
  id?: string;
  title?: ReactNode;
  /** One quiet line under the title: a range, a count, what the figures mean. */
  description?: ReactNode;
  /** A link or control at the header's end, such as View all. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A summary card: the title sits inside the padding without a rule, as on the overview. Tables use `fw-panel`. */
export function Card({ id, title, description, action, children, className }: CardProps) {
  return (
    <section
      aria-labelledby={title && id ? id : undefined}
      className={cx(
        "relative rounded-lg border border-line bg-surface p-4 sm:px-5 sm:py-5",
        className,
      )}
    >
      {title || action ? (
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 id={id} className="text-base font-semibold tracking-tight text-ink">
                {title}
              </h2>
            ) : null}
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
