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
  overdue: AlertTriangle,
  expired: Clock,
  expiredPartiallyPaid: AlertTriangle,
  canceled: Ban,
  settled: Wallet,
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
