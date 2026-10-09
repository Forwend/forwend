import { TONES } from "./tone";

/** Status ids, for code that names one status. */
export const PAYMENT_STATUS = {
  detected: "detected",
  confirming: "confirming",
  paid: "paid",
  partiallyPaid: "partiallyPaid",
  overpaid: "overpaid",
  expired: "expired",
  expiredPartiallyPaid: "expiredPartiallyPaid",
  settled: "settled",
  refundPending: "refundPending",
  refunded: "refunded",
} as const;

// The payment states users see (PROJECT D-29 and domain terms). Labels are final UI copy.
export const PAYMENT_STATUSES = {
  detected: { label: "Detected", tone: TONES.info },
  confirming: { label: "Confirming", tone: TONES.info },
  paid: { label: "Paid", tone: TONES.success },
  partiallyPaid: { label: "Partially paid", tone: TONES.warning },
  overpaid: { label: "Overpaid", tone: TONES.warning },
  expired: { label: "Expired", tone: TONES.neutral },
  expiredPartiallyPaid: { label: "Expired, partially paid", tone: TONES.warning },
  settled: { label: "Settled", tone: TONES.success },
  refundPending: { label: "Refund pending", tone: TONES.accent },
  refunded: { label: "Refunded", tone: TONES.neutral },
} as const;
