import {
  AlertTriangle,
  Ban,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  Clock,
  LoaderCircle,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { cx } from "../../../lib/cx";
import { BADGE_CLASSES, TONE_CLASSES } from "../../../lib/tone";
import { PAYMENT_STATUS, PAYMENT_STATUSES, type PaymentStatus } from "./payment-status";

export interface StatusPillProps {
  status: PaymentStatus;
  /** In long lists Confirmed is the usual end state: a quiet dot, so a status still to wait for stands out. */
  quiet?: boolean;
}

/** Each status's icon: pills, filters and menus show the same one. */
export const PAYMENT_STATUS_ICONS: Record<PaymentStatus, typeof Check> = {
  open: Circle,
  sending: LoaderCircle,
  detected: LoaderCircle,
  confirming: LoaderCircle,
  confirmed: CircleCheck,
  paid: Check,
  partiallyPaid: CircleDashed,
  overpaid: AlertTriangle,
  overdue: AlertTriangle,
  expired: Clock,
  expiredPartiallyPaid: AlertTriangle,
  canceled: Ban,
  settled: Wallet,
  refundPending: RotateCcw,
  refunded: RotateCcw,
};

const PENDING: ReadonlySet<PaymentStatus> = new Set(["sending", "detected", "confirming"]);

export function StatusPill({ status, quiet }: StatusPillProps) {
  const { label, tone } = PAYMENT_STATUSES[status];
  if (quiet && status === PAYMENT_STATUS.confirmed)
    return (
      <span
        data-status={status}
        className="inline-flex items-center gap-1.5 px-2.5 text-xs whitespace-nowrap text-muted"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-success" />
        {label}
      </span>
    );
  const Icon = PAYMENT_STATUS_ICONS[status];
  return (
    <span
      data-status={status}
      className={cx(
        BADGE_CLASSES,
        "transition-colors duration-[var(--fw-duration-base)] ease-out",
        TONE_CLASSES[tone],
      )}
    >
      <Icon
        aria-hidden
        className={cx(
          "size-3.5",
          PENDING.has(status) && "animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]",
        )}
      />
      {label}
    </span>
  );
}
