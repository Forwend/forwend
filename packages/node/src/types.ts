import type { components, operations } from "./openapi.gen.js";

type Schemas = components["schemas"];
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

export type PaymentAmounts = Schemas["PaymentAmounts"];
/** An option's fees, in its token's base units. */
export type OptionFees = Pick<
  Schemas["Payment"],
  "networkFee" | "platformFee" | "netAmount" | "feesPaidBy"
>;
export type PaymentReceipt = Schemas["PaymentReceipt"];
export type CrossChainTx = Schemas["CrossChainTx"];
/** A NEAR Intents payment; amounts are base units of their token, null until 1Click reports them. */
export type CrossChain = Schemas["CrossChainPayment"];
export type Payment = Schemas["Payment"];
/** One payment as payments.get returns it. */
export type PaymentDetails = Schemas["PaymentDetails"];
/** A token and network the payer may pay with. */
export type PaymentOption = Schemas["PaymentOption"];
export type PaymentCoverage = Schemas["PaymentCoverage"];
export type PaymentSettlement = Schemas["PaymentSettlement"];
export type PaymentReturn = PaymentOption["returns"][number];
export type Deposit = Schemas["Deposit"];
export type DepositSummary = Schemas["DepositSummary"];
export type PaymentDelivery = Schemas["PaymentDelivery"];
/** Something about a payment that needs a look, and what to do. */
export type PaymentProblem = Schemas["PaymentProblem"];
/** A merchant profile's store. storeId is public and grants nothing. */
export type Store = Schemas["Store"];
export type CheckoutSession = Schemas["CheckoutSession"];
export type CreateCheckoutSession = Schemas["CreateCheckoutSession"];
export type ListPayments = Query<"listPayments">;
export type ListCheckoutSessions = Query<"listCheckoutSessions">;
/** An invoice in its owner's list. */
export type Invoice = Schemas["InvoiceSummary"];
/** A token and network an invoice accepts, with its own id, amount and receive address. */
export type InvoiceOption = Schemas["InvoiceDetail"]["options"][number];
export type Revision = Schemas["Revision"];
export type InvoiceSend = Schemas["Invoice"]["sends"][number];
export type InvoiceHistory = Schemas["Invoice"]["history"][number];
/** One invoice, as create, get, cancel, reopen, send and webhooks return it. */
export type InvoiceDetails = Schemas["Invoice"];
export type CreateInvoice = Schemas["CreateInvoiceRequest"];
export type ListInvoices = Query<"listInvoices">;
export type ListWebhookEvents = Query<"listWebhookEvents">;
/** Money held for the payer, on invoice.held. */
export type Held = NonNullable<Schemas["WebhookEvent"]["data"]["held"]>;
/** An invoice change, as a webhook carries it and the events list returns it. */
export type WebhookEvent = Schemas["WebhookEvent"];
/** The owner's check of an endpoint: it names no invoice. */
export type TestWebhookEvent = Schemas["WebhookTestEvent"];
