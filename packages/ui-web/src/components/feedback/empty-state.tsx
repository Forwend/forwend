import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  page?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  compact,
  page,
}: EmptyStateProps) {
  return (
    <div
      // The app shell grows the workspace down to this box, so it centers in what is left.
      data-page-empty={page ? "" : undefined}
      className={cx(
        "flex w-full flex-col items-center justify-center px-6 text-center",
        compact
          ? "flex-1 py-10"
          : page
            ? "min-h-64 grow py-10"
            : "min-h-[min(16rem,40dvh)] rounded-lg border border-line bg-surface py-10",
      )}
    >
      <span className="grid size-10 place-items-center rounded-md bg-surface-2">
        <Icon aria-hidden className="size-[var(--fw-icon-lg)] text-muted" />
      </span>
      <p className={cx("font-medium text-ink", compact ? "mt-3 text-sm" : "mt-4 text-lg")}>
        {title}
      </p>
      {description ? (
        <p className={cx("mt-1 max-w-sm text-muted", compact && "text-sm")}>{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
