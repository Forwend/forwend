import { FileText, HandCoins, Link2, ShoppingCart } from "lucide-react";

export const PAYMENT_SOURCES = ["invoice", "checkout", "request", "payment_link"] as const;
/** A sale started on Checkout. */
export const CHECKOUT_SOURCE = "checkout" satisfies (typeof PAYMENT_SOURCES)[number];
export const PAYMENT_VIEWS = {
  all: "all",
  attention: "attention",
  reconciliation: "reconciliation",
} as const;
/** Each source's icon: the table, the overview and the Source filter show the same one. */
export const SOURCE_ICONS = {
  invoice: FileText,
  checkout: ShoppingCart,
  request: HandCoins,
  payment_link: Link2,
} as const satisfies Record<(typeof PAYMENT_SOURCES)[number], unknown>;
export const SOURCE_LABELS = {
  invoice: "Invoice",
  checkout: "Checkout",
  request: "Request",
  payment_link: "Payment link",
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
  webhook_delivery: "Webhook delivery failed or paused",
} as const;
export const PAYMENT_PAGE_SIZE = 25;
