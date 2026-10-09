import { ArrowDownLeft, ArrowUpRight, FileText } from "lucide-react";
import { ACTIVITY_DIRECTIONS } from "../constants/activity";
import type { ActivityRowProps } from "../types/payments/display";
import { Money } from "./money";
import { StatusPill } from "./status-pill";

export function ActivityRow({ title, detail, direction, amount, status }: ActivityRowProps) {
  const incoming = direction === ACTIVITY_DIRECTIONS.incoming;
  const request = direction === ACTIVITY_DIRECTIONS.request;
  const Icon = request ? FileText : incoming ? ArrowDownLeft : ArrowUpRight;
  const sign = request ? "" : incoming ? "+" : "−";
  return (
    <div className="flex items-center gap-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-pill border border-line bg-surface-2 text-muted">
        <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{title}</span>
        <span className="block truncate text-sm text-muted">{detail}</span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className={incoming ? "text-success" : "text-ink"}>
          {sign}
          <Money {...amount} />
        </span>
        <StatusPill status={status} />
      </span>
    </div>
  );
}
