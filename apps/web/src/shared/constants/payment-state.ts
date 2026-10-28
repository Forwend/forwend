/** Invoice.paymentStatus values: the raw per-option status the ledger writes. */
export const API_PAYMENT_STATUSES = {
  open: "open",
  detected: "detected",
  partiallyPaid: "partially_paid",
  paid: "paid",
  expired: "expired",
  expiredPartiallyPaid: "expired_partially_paid",
  canceled: "canceled",
} as const;

/** Invoice.settlementStatus values. */
export const API_SETTLEMENT_STATUSES = {
  none: "none",
  pending: "pending",
  settled: "settled",
} as const;

/** Deposit.status values. */
export const API_DEPOSIT_STATUSES = {
  detected: "detected",
  confirmed: "confirmed",
} as const;

/** Payment.state values: the backend's derived payment status (D-114). */
export const API_PAYMENT_STATES = {
  waiting: "waiting",
  confirming: "confirming",
  partiallyPaid: "partially_paid",
  paid: "paid",
  overpaid: "overpaid",
  expired: "expired",
  canceled: "canceled",
} as const;

/** Payment.wallet values: where the merchant's share of a paid payment is (D-114). */
export const API_WALLET_STATES = {
  none: "none",
  pending: "pending",
  inWallet: "in_wallet",
  delayed: "delayed",
  refused: "refused",
} as const;
