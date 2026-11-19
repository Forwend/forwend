import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export interface CardProps {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  actionBelow?: boolean;
  children: ReactNode;
  className?: string;
}

/** A summary card with its title inside the padding; tables use `fw-panel`. */
export function Card({
  id,
  title,
  description,
  action,
  actionBelow,
  children,
  className,
}: CardProps) {
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
          {action ? (
            <div className={cx("shrink-0", actionBelow && "max-sm:basis-full")}>{action}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
