import { TONES } from "../../../lib/tone";

/** Status ids, for code that names one status. */
export const PAYMENT_STATUS = {
  open: "open",
  detected: "detected",
  confirming: "confirming",
  confirmed: "confirmed",
  paid: "paid",
  partiallyPaid: "partiallyPaid",
  overpaid: "overpaid",
  overdue: "overdue",
  expired: "expired",
  expiredPartiallyPaid: "expiredPartiallyPaid",
  canceled: "canceled",
  settled: "settled",
  refundPending: "refundPending",
  refunded: "refunded",
} as const;

// The payment states users see (D-114). Labels are final UI copy. Detected and confirming are still pending: neutral,
// never the info or success colors, so nobody reads them as done. Settled money is "In wallet" everywhere.
export const PAYMENT_STATUSES = {
  open: { label: "Waiting for payment", tone: TONES.neutral },
  detected: { label: "Detected", tone: TONES.neutral },
  confirming: { label: "Confirming", tone: TONES.neutral },
  confirmed: { label: "Confirmed", tone: TONES.success },
  paid: { label: "Paid", tone: TONES.success },
  partiallyPaid: { label: "Partially paid", tone: TONES.warning },
  overpaid: { label: "Overpaid", tone: TONES.warning },
  overdue: { label: "Overdue", tone: TONES.warning },
  expired: { label: "Expired", tone: TONES.neutral },
  expiredPartiallyPaid: { label: "Expired, partially paid", tone: TONES.warning },
  canceled: { label: "Canceled", tone: TONES.neutral },
  settled: { label: "In wallet", tone: TONES.success },
  refundPending: { label: "Refund pending", tone: TONES.accent },
  refunded: { label: "Returned", tone: TONES.neutral },
} as const;

export type PaymentStatus = keyof typeof PAYMENT_STATUSES;

/** Where the merchant's share of a paid payment is (D-114): kept apart from the payment status. */
export const WALLET_STATE = {
  none: "none",
  pending: "pending",
  inWallet: "inWallet",
  delayed: "delayed",
  refused: "refused",
} as const;

export const WALLET_STATES = {
  none: { label: "No transfer yet", tone: TONES.neutral },
  pending: { label: "Pending", tone: TONES.neutral },
  inWallet: { label: "In wallet", tone: TONES.success },
  delayed: { label: "Delayed", tone: TONES.warning },
  refused: { label: "Needs review", tone: TONES.danger },
} as const;

export type WalletState = keyof typeof WALLET_STATES;
