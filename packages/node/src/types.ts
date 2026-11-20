import type { components, operations } from "./openapi.gen.js";

type Schemas = components["schemas"];
// An interface keeps the published names open to declaration merging; it cannot extend an indexed type directly.
type Of<T> = T;
type Query<Operation extends keyof operations> = NonNullable<
  operations[Operation]["parameters"]["query"]
>;

/** The invoice events a webhook carries. */
export const WEBHOOK_EVENT_TYPES = [
  "invoice.detected",
  "invoice.partially_paid",
  "invoice.paid",
  "invoice.settled",
  "invoice.expired",
  "invoice.canceled",
  "invoice.held",
  "invoice.open",
  "invoice.reopened",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const PAYMENT_STATUSES = [
  "open",
  "detected",
  "partially_paid",
  "paid",
  "expired",
  "expired_partially_paid",
  "canceled",
] as const;
export const SETTLEMENT_STATUSES = ["none", "pending", "settled"] as const;
export const REFUND_STATUSES = ["none", "held", "refund_pending", "refunded"] as const;
/** The invoice list's status filter. */
export const LIST_STATUSES = [
  "open",
  "confirming",
  "paid",
  "settled",
  "expired",
  "canceled",
] as const;
/** Why money is held for the payer. */
export const HELD_REASONS = ["overpaid", "late", "expired", "canceled", "other_option"] as const;
/** 1Click's statuses of a NEAR Intents payment; SUCCESS, REFUNDED and FAILED are final. */
export const CROSS_CHAIN_STATUSES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type CrossChainStatus = (typeof CROSS_CHAIN_STATUSES)[number];
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type ListStatus = (typeof LIST_STATUSES)[number];
export type HeldReason = (typeof HELD_REASONS)[number];
export const PAYMENT_PURPOSES = ["invoice", "checkout", "request"] as const;
export const PAYMENT_SOURCES = [...PAYMENT_PURPOSES, "payment_link"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];
export const DOCUMENT_KINDS = ["invoice", "request", "none"] as const;
export const CHECKOUT_STATES = ["open", "complete", "expired"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type CheckoutState = (typeof CHECKOUT_STATES)[number];
/** The merchant's payment state; paymentStatus keeps the raw value. */
export const PAYMENT_STATES = [
  "waiting",
  "confirming",
  "partially_paid",
  "paid",
  "overpaid",
  "expired",
  "canceled",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];
/** Where the received money is on its way to the profile's wallet. */
export const WALLET_STATES = ["none", "pending", "in_wallet", "delayed", "refused"] as const;
export type WalletState = (typeof WALLET_STATES)[number];
export const RECONCILIATION_STATUSES = ["verified", "pending", "review"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
export const FEES_PAID_BY = ["owner", "client"] as const;
/** owner: the fees are deducted at settlement. client: they are added on top of the price. */
export type FeesPaidBy = (typeof FEES_PAID_BY)[number];
export const DEPOSIT_STATUSES = ["detected", "confirmed"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];
export const PAYMENT_PROBLEM_CODES = [
  "verification_pending",
  "reconciliation_required",
  "partial_payment",
  "held_funds",
  "outflow_unreconciled",
  "funds_movement_exception",
  "settlement_delayed",
  "settlement_refused",
  "webhook_delivery",
] as const;
export const PAYMENT_PROBLEM_ACTIONS = [
  "wait",
  "share_checkout",
  "review_funds",
  "review_settlement",
  "review_webhooks",
  "ask_admin",
] as const;
export const SETTLEMENT_WAITS = [
  "signing",
  "finalizing",
  "retrying",
  "dailyLimit",
  "refused",
] as const;
export const REMINDER_STEPS = ["before", "due", "after"] as const;
export const HISTORY_ACTORS = ["owner", "payer", "system"] as const;
/** The fields whose edits the payer sees. */
export const UPDATE_FIELDS = ["reference", "note", "dueDate"] as const;
export const EDITED_FIELDS = ["memo", "clientEmail", "returnUrl", ...UPDATE_FIELDS] as const;
export type SettlementWait = (typeof SETTLEMENT_WAITS)[number];
export type ReminderStep = (typeof REMINDER_STEPS)[number];
export type HistoryActor = (typeof HISTORY_ACTORS)[number];
export type UpdateField = (typeof UPDATE_FIELDS)[number];
export type EditedField = (typeof EDITED_FIELDS)[number];

export interface PaymentAmounts extends Of<Schemas["PaymentAmounts"]> {}
/** An option's fees, in its token's base units. */
export interface OptionFees
  extends Pick<Schemas["Payment"], "networkFee" | "platformFee" | "netAmount" | "feesPaidBy"> {}
export interface PaymentReceipt extends Of<Schemas["PaymentReceipt"]> {}
export interface CrossChainTx extends Of<Schemas["CrossChainTx"]> {}
/** A NEAR Intents payment; amounts are base units of their token, null until 1Click reports them. */
export interface CrossChain extends Of<Schemas["CrossChainPayment"]> {}
export interface Payment extends Of<Schemas["Payment"]> {}
/** One payment as payments.get returns it. */
export interface PaymentDetails extends Of<Schemas["PaymentDetails"]> {}
/** A token and network the payer may pay with. */
export interface PaymentOption extends Of<Schemas["PaymentOption"]> {}
export interface PaymentCoverage extends Of<Schemas["PaymentCoverage"]> {}
export interface PaymentSettlement extends Of<Schemas["PaymentSettlement"]> {}
export interface PaymentReturn extends Of<PaymentOption["returns"][number]> {}
export interface Deposit extends Of<Schemas["Deposit"]> {}
export interface DepositSummary extends Of<Schemas["DepositSummary"]> {}
export interface PaymentDelivery extends Of<Schemas["PaymentDelivery"]> {}
/** Something about a payment that needs a look, and what to do. */
export interface PaymentProblem extends Of<Schemas["PaymentProblem"]> {}
/** A merchant profile's store. storeId is public and grants nothing. */
export interface Store extends Of<Schemas["Store"]> {}
export interface CheckoutSession extends Of<Schemas["CheckoutSession"]> {}
export interface CreateCheckoutSession extends Of<Schemas["CreateCheckoutSession"]> {}
export interface ListPayments extends Query<"listPayments"> {}
export interface ListCheckoutSessions extends Query<"listCheckoutSessions"> {}
/** An invoice in its owner's list. */
export interface Invoice extends Of<Schemas["InvoiceSummary"]> {}
/** A token and network an invoice accepts, with its own id, amount and receive address. */
export interface InvoiceOption extends Of<Schemas["InvoiceDetail"]["options"][number]> {}
export interface Revision extends Of<Schemas["Revision"]> {}
export interface InvoiceSend extends Of<Schemas["Invoice"]["sends"][number]> {}
export interface InvoiceHistory extends Of<Schemas["Invoice"]["history"][number]> {}
/** One invoice, as create, get, cancel, reopen, send and webhooks return it. */
export interface InvoiceDetails extends Of<Schemas["Invoice"]> {}
export interface CreateInvoice extends Of<Schemas["CreateInvoiceRequest"]> {}
export interface ListInvoices extends Query<"listInvoices"> {}
export interface ListWebhookEvents extends Query<"listWebhookEvents"> {}
/** Money held for the payer, on invoice.held. */
export interface Held extends NonNullable<Schemas["WebhookEvent"]["data"]["held"]> {}
/** An invoice change, as a webhook carries it and the events list returns it. */
export interface WebhookEvent extends Of<Schemas["WebhookEvent"]> {}
/** The owner's check of an endpoint: it names no invoice. */
export interface TestWebhookEvent extends Of<Schemas["WebhookTestEvent"]> {}
