/** Invoice.paymentStatus values. */
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

/** The API's limit on rows per request. */
export const ACTIVITY_MAX = 100;

export const ACTIVITY_KINDS = {
  invoice: "invoice",
  deposit: "deposit",
} as const;

export const ACTIVITY_PAGE_SIZE = 20;

export const STATUS_FILTERS = {
  all: "all",
  open: "open",
  paid: "paid",
  settled: "settled",
  expired: "expired",
  canceled: "canceled",
} as const;
