import { ArrowDownLeft, ArrowUpRight, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Money, type MoneyProps } from "./money/money";
import { PAYMENT_STATUS, PAYMENT_STATUSES, type PaymentStatus } from "./status-pill/payment-status";
import { StatusPill } from "./status-pill/status-pill";

export const ACTIVITY_DIRECTIONS = {
  incoming: "incoming",
  outgoing: "outgoing",
  request: "request", // no money moved yet: no sign
} as const;

export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[keyof typeof ACTIVITY_DIRECTIONS];

export interface ActivityRowProps {
  title: ReactNode;
  detail: ReactNode;
  direction: ActivityDirection;
  amount: MoneyProps;
  status: PaymentStatus;
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
  const size = amount.baseUnits < 0n ? -amount.baseUnits : amount.baseUnits;
  return (
    <div className="@container flex items-center gap-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-pill border border-line bg-surface-2 text-muted">
        <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate font-medium text-ink"
          title={typeof title === "string" ? title : undefined}
        >
          {title}
        </span>
        <span
          className="block truncate text-sm text-muted"
          title={typeof detail === "string" ? detail : undefined}
        >
          {detail}
        </span>
      </span>
      <span className="flex min-w-0 flex-col items-end gap-1 @2xl:flex-row-reverse @2xl:items-center @2xl:gap-6">
        <span className={`@2xl:min-w-28 @2xl:text-right ${incoming ? "text-success" : "text-ink"}`}>
          <Money {...amount} baseUnits={size} sign={sign} />
        </span>
        <span className="flex items-center gap-1">
          {action}
          {status === PAYMENT_STATUS.confirmed ? (
            <span className="max-sm:sr-only inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-transparent px-2.5 py-1 text-xs text-muted">
              <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-success" />
              {PAYMENT_STATUSES.confirmed.label}
            </span>
          ) : (
            <StatusPill status={status} />
          )}
        </span>
      </span>
    </div>
  );
}
