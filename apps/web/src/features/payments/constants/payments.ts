export const PAYMENT_SOURCES = ["invoice", "checkout", "request", "payment_link"] as const;
export const PAYMENT_VIEWS = {
  all: "all",
  attention: "attention",
  reconciliation: "reconciliation",
} as const;
export const SOURCE_LABELS = {
  invoice: "Invoice",
  checkout: "Checkout",
  request: "Personal request",
  payment_link: "Payment link",
} as const;
export const PAYMENT_PROBLEMS = {
  verification_pending: "Checking payment records",
  reconciliation_required: "Payment records need review",
  partial_payment: "Partly paid",
  held_funds: "Funds held for the payer",
  outflow_unreconciled: "Outgoing transfer not yet confirmed",
  funds_movement_exception: "Unexpected transfer",
  settlement_delayed: "Settlement delayed",
  settlement_refused: "Settlement refused",
  webhook_delivery: "Webhook delivery failed",
} as const;
export const PAYMENT_PAGE_SIZE = 25;
