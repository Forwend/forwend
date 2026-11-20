import { FileText, HandCoins, Link2, ShoppingCart } from "lucide-react";

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
/** The Payments page's filters in its URL; all but view are the API's query names. */
export const PAYMENT_PARAMS = {
  view: "view",
  state: "state",
  source: "source",
  storeId: "storeId",
  linkId: "linkId",
  settlementStatus: "settlementStatus",
} as const;

export const PAYMENT_VIEWS = {
  all: "all",
  attention: "attention",
  reconciliation: "reconciliation",
} as const;
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
export const PROBLEM_CODES = {
  heldFunds: "held_funds",
  partialPayment: "partial_payment",
  verificationPending: "verification_pending",
  outflowUnreconciled: "outflow_unreconciled",
  settlementDelayed: "settlement_delayed",
  settlementRefused: "settlement_refused",
  webhookDelivery: "webhook_delivery",
} as const satisfies Record<string, keyof typeof PAYMENT_PROBLEMS>;
export const PROBLEM_ACTIONS = {
  wait: "wait",
  reviewWebhooks: "review_webhooks",
  askAdmin: "ask_admin",
} as const;
export const SETTLEMENT_STATES = { sent: "sent", refused: "refused" } as const;
export const SETTLEMENT_HOLDS = { unresolved: "unresolved", cap: "cap" } as const;
/** Each follows an amount: "0.50 USDC over the amount". */
export const HELD_REASONS = {
  overpaid: "over the amount",
  late: "paid after the checkout closed",
  expired: "from a partial payment",
  canceled: "paid after you canceled",
  other_option: "paid with an option the customer didn't choose",
} as const;
export const PAYMENT_PAGE_SIZE = 25;
/** In the order the sum reads: what came in, what was taken, what is left. */
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
export const JOURNEY_KINDS = {
  created: "created",
  origin: "origin",
  surplus: "surplus",
  converting: "converting",
  awaiting: "awaiting",
  deposit: "deposit",
  fee: "fee",
  wallet: "wallet",
  closed: "closed",
  returned: "returned",
} as const;
