import { ArrowDownLeft, ArrowUpRight, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Money, type MoneyProps } from "./money";
import type { PaymentStatus } from "./payment-status";
import { StatusPill } from "./status-pill";

export const ACTIVITY_DIRECTIONS = {
  incoming: "incoming",
  outgoing: "outgoing",
  /** A request such as an invoice: no money moved yet, so no sign. */
  request: "request",
} as const;

export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[keyof typeof ACTIVITY_DIRECTIONS];

export interface ActivityRowProps {
  /** Text, or a link that the row opens. */
  title: ReactNode;
  detail: string;
  direction: ActivityDirection;
  amount: MoneyProps;
  status: PaymentStatus;
  /** A small control beside the status, such as a link to the transaction. */
  action?: ReactNode;
}

export function ActivityRow({
  title,
  detail,
  direction,
  amount,
  status,
  action,
}: ActivityRowProps) {
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
        <span className="flex items-center gap-1">
          {action}
          <StatusPill status={status} />
        </span>
      </span>
    </div>
  );
}
