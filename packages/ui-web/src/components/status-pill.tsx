import { AlertTriangle, Check, CircleDashed, CircleDot, Clock, RotateCcw } from "lucide-react";
import { PAYMENT_STATUSES } from "../constants/payment-status";
import { cx } from "../lib/cx";
import { TONE_CLASSES } from "../lib/tone";
import type { PaymentStatus, StatusPillProps } from "../types/payments/display";

const STATUS_ICONS: Record<PaymentStatus, typeof Check> = {
  detected: CircleDot,
  confirming: Clock,
  paid: Check,
  partiallyPaid: CircleDashed,
  overpaid: AlertTriangle,
  expired: Clock,
  expiredPartiallyPaid: AlertTriangle,
  settled: Check,
  refundPending: RotateCcw,
  refunded: RotateCcw,
};

export function StatusPill({ status }: StatusPillProps) {
  const { label, tone } = PAYMENT_STATUSES[status];
  const Icon = STATUS_ICONS[status];
  return (
    <span
      data-status={status}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
      )}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      {label}
    </span>
  );
}
