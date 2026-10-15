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

// One centered block that fills the list's place, so an empty or filtered-out list never looks broken (R-75).
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
          ? "py-10"
          : "min-h-[min(22rem,55dvh)] rounded-lg border border-line bg-surface py-12",
      )}
    >
      <span className="grid size-12 place-items-center rounded-pill bg-surface-2">
        <Icon aria-hidden className="size-[var(--fw-icon-lg)] text-muted" />
      </span>
      <p className="mt-4 text-lg font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
