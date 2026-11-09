/** The invoice events a webhook carries (docs/backend/api.md, R-147). */
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

// The values openapi.yaml lists for each status.
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

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
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

/** The merchant's payment state (D-114); paymentStatus keeps its raw value. */
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
/** Where the received money is on its way to the profile's wallet (D-114). */
export const WALLET_STATES = ["none", "pending", "in_wallet", "delayed", "refused"] as const;
export type WalletState = (typeof WALLET_STATES)[number];

export const RECONCILIATION_STATUSES = ["verified", "pending", "review"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
export interface PaymentAmounts {
  reconciliationStatus: ReconciliationStatus;
  receiver: string;
  payable: string;
  held: string;
  /** What settlement paid the recipient: the amount less the fees. */
  settled: string;
  /** The network and platform fees settlement paid. */
  fees: string;
  refunded: string;
  observedRefunded: string;
  lastReturnTxHash: string | null;
  unreconciled: boolean;
  hasPolicyException: boolean;
}

export const FEES_PAID_BY = ["owner", "client"] as const;
/** owner: the fees are deducted at settlement. client: they are added on top of the price. */
export type FeesPaidBy = (typeof FEES_PAID_BY)[number];

/** An option's fees, in base units of its token, and what the owner receives of its amount. */
export interface OptionFees {
  /** Paid at settlement to the settler for its gas. */
  networkFee: string;
  /** Paid at settlement to Forwend; 0 at launch. */
  platformFee: string;
  /** The amount less both fees. */
  netAmount: string;
  feesPaidBy: FeesPaidBy;
}

export interface PaymentReceipt {
  optionId: string;
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  received: string;
  pending: string;
  /** Booked money on this option still owed to the payer. */
  held: string;
}

export interface Payment extends OptionFees {
  receipts: PaymentReceipt[];
  customerName: string | null;
  customerEmail: string | null;
  amounts?: PaymentAmounts;
  paymentId: string;
  source: PaymentSource;
  optionId: string;
  optionLocked: boolean;
  optionCount: number;
  symbol: string;
  decimals: number;
  purpose: PaymentPurpose;
  documentKind: DocumentKind;
  number: number | null;
  storeId: string | null;
  storeName: string | null;
  linkId: string | null;
  livemode: boolean;
  title: string | null;
  reference: string | null;
  chainId: number;
  token: string;
  amount: string;
  paymentStatus: PaymentStatus;
  settlementStatus: SettlementStatus;
  refundStatus: RefundStatus;
  state: PaymentState;
  wallet: WalletState;
  dueDate: string | null;
  confirming: boolean;
  closed: boolean;
  createdAt: string;
  closesAt: string;
  hostedUrl: string | null;
  /** The hosted page's token, the last part of hostedUrl: what @forwend/js and @forwend/react take. */
  payToken: string | null;
}

/** One payment with its line items, options and open problems, as payments.get returns it. */
export interface PaymentDetails extends Payment {
  customer: { name: string | null; email: string | null };
  metadata: Record<string, string>;
  /** Money in the base units of the option whose optionId is the paymentId; quantity has 2 decimals. */
  items: { description: string; quantity: string; unitPrice: string; amount: string }[];
  options: PaymentOption[];
  deliveries: PaymentDelivery[];
  deliveryCount: number;
  deliveriesTruncated: boolean;
  problems: PaymentProblem[];
  snapshotAt: string;
}

/** A token and network the payer may pay with. The fields a server most often needs are typed; the rest stay as sent. */
export interface PaymentOption extends OptionFees {
  optionId: string;
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  amount: string;
  receiveAddress: string;
  closesAt: string;
  paymentStatus: PaymentStatus;
  settlementStatus: SettlementStatus;
  refundStatus: RefundStatus;
  amounts: PaymentAmounts | null;
  [field: string]: unknown;
}

export interface PaymentDelivery {
  endpointId: string;
  eventId: string;
  eventType: WebhookEventType;
  status: string;
  enabled: boolean;
  attempts: number;
  lastStatusCode: number | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string;
  canManage: boolean;
}

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

/** Something about a payment that needs a look, and what to do. */
export interface PaymentProblem {
  code: (typeof PAYMENT_PROBLEM_CODES)[number];
  action: (typeof PAYMENT_PROBLEM_ACTIONS)[number];
  amount: string | null;
  asset: { chainId: number; token: string; symbol: string; decimals: number } | null;
  optionId: string | null;
  endpointId: string | null;
  eventId: string | null;
  reason: string | null;
}

/** A merchant profile's store. storeId is public and grants nothing. */
export interface Store {
  storeId: string;
  name: string;
  defaultExpiresIn: number;
  /** The origins that may frame this store's checkout. */
  allowedOrigins: string[];
  brandColor: string | null;
  logoAt: string | null;
  tokensOff: { chainId: number; token: string }[];
  updatedAt: string;
}

export interface CheckoutSession {
  sessionId: string;
  status: CheckoutState;
  payment: Payment;
}

export interface CreateCheckoutSession {
  storeId: string;
  amountUsd: string;
  reference?: string;
  title?: string;
  expiresIn?: number;
  /** Who pays the fees; left out, the profile's choice. client adds them to the price. */
  feesPaidBy?: FeesPaidBy;
  returnUrl?: string;
  metadata?: CreateInvoice["metadata"];
  customer?: Pick<NonNullable<CreateInvoice["client"]>, "name" | "email">;
  items?: CreateInvoice["lines"];
}

export interface ListPayments extends ListCheckoutSessions {
  q?: string;
  source?: PaymentSource;
  linkId?: string;
  status?: ListStatus;
  paymentStatus?: PaymentStatus;
  settlementStatus?: SettlementStatus;
  refundStatus?: RefundStatus;
  state?: PaymentState;
  wallet?: WalletState;
  /** Exactly your order's reference. */
  reference?: string;
}

export interface ListCheckoutSessions {
  limit?: number;
  cursor?: string;
  storeId?: string;
}

/** An invoice as its owner reads it. The fields a server most often needs are typed; the rest stay as sent. */
export interface Invoice extends OptionFees {
  amounts?: PaymentAmounts;
  purpose?: PaymentPurpose;
  documentKind?: DocumentKind;
  linkId?: string;
  invoiceId: string;
  /** Null for a payment-link invoice before its first deposit. */
  number: number | null;
  payToken: string | null;
  chainId: number;
  livemode: boolean;
  token: string;
  amount: string;
  paymentStatus: PaymentStatus;
  settlementStatus: SettlementStatus;
  refundStatus: RefundStatus;
  reference: string | null;
  returnUrl: string | null;
  expiresAt: string;
  closesAt: string;
  createdAt: string;
  metadata: Record<string, string>;
  [field: string]: unknown;
}

/** What a create takes; the API checks each value (docs/backend/api.md). */
export interface CreateInvoice {
  chainId?: number;
  token?: string;
  /** Base units of the token, as a string. */
  amount?: string;
  /** Or a USD amount the payer pays in any accepted stablecoin. */
  amountUsd?: string;
  expiresIn?: number;
  /** Who pays the fees; left out, the profile's choice. client adds them to the price. */
  feesPaidBy?: FeesPaidBy;
  title?: string;
  note?: string;
  dueDate?: string;
  supplyDate?: string;
  reference?: string;
  senderName?: string;
  returnUrl?: string;
  storeId?: string;
  metadata?: Record<string, string>;
  client?: { name?: string; email?: string; address?: string; country?: string; taxId?: string };
  /** Line items that add up exactly to amount or amountUsd. */
  lines?: { description: string; quantity: string; unitPrice: string }[];
  /** A price agreed in fiat: decimal major units, e.g. "10.50" for EUR 10.50. */
  agreedValue?: { currency: string; amount: string; date: string };
  reminders?: boolean;
  /** The profile's invoice this one replaces. */
  replaces?: string;
  /** Repeat every month until endDate, or until stopped. */
  repeat?: { endDate?: string };
}

export interface ListInvoices {
  /** Items per page, 1 to 100. */
  limit?: number;
  status?: ListStatus;
  state?: PaymentState;
  /** Search text, as the owner's invoice list takes it. */
  q?: string;
  /** Start after this cursor instead of the first page. */
  cursor?: string;
}

export interface ListWebhookEvents {
  /** Events per page, 1 to 100. */
  limit?: number;
  type?: WebhookEventType;
  cursor?: string;
}

/** Money held for the payer, on invoice.held. */
export interface Held {
  amount: string;
  reason: HeldReason;
  optionId: string | null;
}

/** An invoice change, as a webhook carries it and the events list returns it. */
export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  livemode: boolean;
  /** The invoice's events in order, from 1. */
  sequence: number;
  timestamp: string;
  data: { invoice: Invoice; held: Held | null };
}

/** The owner's check of an endpoint: it names no invoice. */
export interface TestWebhookEvent {
  id: string;
  type: "webhook.test";
  livemode: boolean;
  timestamp: string;
  data: Record<string, never>;
}
