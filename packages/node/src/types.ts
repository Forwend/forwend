/** The invoice events a webhook carries (docs/backend/api.md, R-147). */
export const WEBHOOK_EVENT_TYPES = [
  "invoice.detected",
  "invoice.partially_paid",
  "invoice.paid",
  "invoice.settled",
  "invoice.expired",
  "invoice.canceled",
  "invoice.held",
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
export const LIST_STATUSES = ["open", "paid", "settled", "expired", "canceled"] as const;
/** Why money is held for the payer. */
export const HELD_REASONS = ["overpaid", "late", "expired", "canceled", "other_option"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type ListStatus = (typeof LIST_STATUSES)[number];
export type HeldReason = (typeof HELD_REASONS)[number];

/** An invoice as its owner reads it. The fields a server most often needs are typed; the rest stay as sent. */
export interface Invoice {
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
  /** A price agreed in fiat: amount in the currency's minor units. */
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
