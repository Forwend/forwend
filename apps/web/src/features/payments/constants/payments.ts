export const PAYMENT_SOURCES = ["invoice", "checkout", "request", "payment_link"] as const;
export const PAYMENT_VIEWS = {
  all: "all",
  attention: "attention",
  reconciliation: "reconciliation",
} as const;
export const SOURCE_LABELS = {
  invoice: "Invoice",
  checkout: "Checkout",
  request: "Request",
  payment_link: "Payment link",
} as const;
/** The payment status filter, as the API's `state` values (D-114). */
export const PAYMENT_STATE_FILTERS = {
  all: "all",
  waiting: "waiting",
  confirming: "confirming",
  partiallyPaid: "partially_paid",
  paid: "paid",
  overpaid: "overpaid",
  expired: "expired",
  canceled: "canceled",
} as const;
export const PAYMENT_PROBLEMS = {
  verification_pending: "Checking payment records",
  reconciliation_required: "Payment records need review",
  partial_payment: "Partially paid",
  held_funds: "Money held for the payer",
  outflow_unreconciled: "Outgoing transfer not yet confirmed",
  funds_movement_exception: "Unexpected transfer",
  settlement_delayed: "Wallet transfer delayed",
  settlement_refused: "Wallet transfer refused",
  webhook_delivery: "Webhook delivery failed",
} as const;
export const PAYMENT_PAGE_SIZE = 25;
