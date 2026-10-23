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
} from "lucide-react";
import { cx } from "../../../lib/cx";
import { TONE_CLASSES } from "../../../lib/tone";
import { PAYMENT_STATUSES, type PaymentStatus } from "./payment-status";

export interface StatusPillProps {
  status: PaymentStatus;
}

const STATUS_ICONS: Record<PaymentStatus, typeof Check> = {
  open: Circle,
  detected: LoaderCircle,
  confirming: LoaderCircle,
  confirmed: CircleCheck,
  paid: Check,
  partiallyPaid: CircleDashed,
  overpaid: AlertTriangle,
  expired: Clock,
  expiredPartiallyPaid: AlertTriangle,
  canceled: Ban,
  settled: Check,
  refundPending: RotateCcw,
  refunded: RotateCcw,
};

const PENDING: ReadonlySet<PaymentStatus> = new Set(["detected", "confirming"]);

export function StatusPill({ status }: StatusPillProps) {
  const { label, tone } = PAYMENT_STATUSES[status];
  const Icon = STATUS_ICONS[status];
  return (
    <span
      data-status={status}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors duration-[var(--fw-duration-base)] ease-out",
        TONE_CLASSES[tone],
      )}
    >
      <Icon
        aria-hidden
        className={cx(
          "size-[var(--fw-icon-sm)]",
          PENDING.has(status) && "animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]",
        )}
      />
      {label}
    </span>
  );
}
