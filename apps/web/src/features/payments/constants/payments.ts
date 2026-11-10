import { FileText, HandCoins, Link2, ShoppingCart } from "lucide-react";

/** What made a payment: an invoice, a sale on Checkout, a request or a payment link. */
export const PAYMENT_SOURCE = {
  invoice: "invoice",
  checkout: "checkout",
  request: "request",
  paymentLink: "payment_link",
} as const;
export const PAYMENT_SOURCES = [
  PAYMENT_SOURCE.invoice,
  PAYMENT_SOURCE.checkout,
  PAYMENT_SOURCE.request,
  PAYMENT_SOURCE.paymentLink,
] as const;
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
  held_funds: "Money held for the customer",
  outflow_unreconciled: "Outgoing transfer not yet confirmed",
  funds_movement_exception: "Unexpected transfer",
  settlement_delayed: "Wallet transfer delayed",
  settlement_refused: "Wallet transfer refused",
  webhook_delivery: "Webhook delivery failed or paused",
} as const;
/** Why money is held for the payer, by the API's reason (D-26): each follows an amount, as "0.50 USDC over the amount". */
export const HELD_REASONS = {
  overpaid: "over the amount",
  late: "paid after the checkout closed",
  expired: "from a partial payment",
  canceled: "paid after you canceled",
  other_option: "paid with an option the customer didn't choose",
} as const;
export const PAYMENT_PAGE_SIZE = 25;
/** The figures of a payment page's sum (R-248), in the order it reads: what came in, what was taken, what is left. */
export const SUM_CELLS = {
  requested: "requested",
  paid: "paid",
  returned: "returned",
  held: "held",
  due: "due",
  networkFee: "networkFee",
  platformFee: "platformFee",
  wallet: "wallet",
} as const;
/** The rows of How the money moved (R-248). */
export const JOURNEY_KINDS = {
  created: "created",
  origin: "origin",
  converting: "converting",
  awaiting: "awaiting",
  deposit: "deposit",
  fee: "fee",
  wallet: "wallet",
  closed: "closed",
  returned: "returned",
} as const;
