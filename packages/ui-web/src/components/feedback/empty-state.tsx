import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  /** Inside a panel that already has its frame, such as an overview card: no border, less height. */
  compact?: boolean;
}

// R-75: an empty or filtered-out list never looks broken.
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex w-full flex-col items-center justify-center px-6 text-center",
        compact
          ? "flex-1 py-10"
          : "min-h-[min(16rem,40dvh)] rounded-lg border border-line bg-surface py-10",
      )}
    >
      <span className="grid size-10 place-items-center rounded-md bg-surface-2">
        <Icon aria-hidden className="size-[var(--fw-icon-lg)] text-muted" />
      </span>
      {/* In a card it reads like the card's error state: one quiet line, not a page heading. */}
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
