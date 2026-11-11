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

/** 1Click's statuses of a payment through NEAR Intents (D-123); SUCCESS, REFUNDED and FAILED are final. */
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

/** A transaction 1Click names; explorerUrl is "" when 1Click gave no https link. */
export interface CrossChainTx {
  hash: string;
  explorerUrl: string;
}

/**
 * How a payment through NEAR Intents went (R-235). The payer sent the token on its own chain; 1Click delivered exactly
 * amountOut of the option's USDC on Base. amountIn, deposited and refunded are in the token's base units; amounts are
 * null until 1Click says.
 */
export interface CrossChain {
  provider: "near_intents";
  quoteId: string;
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  depositAddress: string;
  refundTo: string;
  amountIn: string;
  minAmountIn: string;
  amountOut: string;
  status: CrossChainStatus;
  deposited: string | null;
  delivered: string | null;
  refunded: string | null;
  refundReason: string | null;
  originTxs: CrossChainTx[];
  destinationTxs: CrossChainTx[];
  shownUntil: string;
  deadline: string;
  createdAt: string;
  depositSeenAt: string | null;
  convertedAt: string | null;
  /** 1Click's signed answer, as the pay page checks it (D-124). */
  signed: Record<string, unknown>;
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
  /** A payment through NEAR Intents; a list fills it only while the deposit pays the payment. With status SUCCESS it
   * paid the payment if optionLocked is false or optionId is the Base USDC option; if not, the USDC is held. */
  crossChain: CrossChain | null;
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

/** A token and network the payer may pay with. */
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
  coverage: PaymentCoverage;
  settlement: PaymentSettlement | null;
  /** Held money the refund authority sent back to a payer, in chain order. */
  returns: PaymentReturn[];
  deposits: Deposit[];
  /** More transfers reached the address than deposits lists. */
  depositsTruncated: boolean;
}

/** How far the scan of an option's address got, and what it could not book yet. */
export interface PaymentCoverage {
  /** False once the scan no longer reads the address's deposits. */
  historyComplete: boolean;
  verifiedBlock: number | null;
  verifiedHash: string | null;
  verifiedTime: string | null;
  observedBalance: string | null;
  balanceDifference: string | null;
  reconciliationError: string | null;
  bookingError: string | null;
  retryAt: string | null;
  updatedAt: string;
  chainFinalizedBlock: number | null;
  pendingDeposits: number;
  unbookedDeposits: number;
  /** 1 while the final balance holds more than every recorded deposit: a deposit the scan missed. */
  unprovedDeposits: number;
  unbookedOutflows: number;
}

/** The move of an option's money to the profile wallet. */
export interface PaymentSettlement {
  status: string;
  wait: string | null;
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  signedAt: string | null;
  txHash: string | null;
  /** The settlement seen to succeed, a mined replacement too; for display only. */
  receiptTxHash: string | null;
  blockNumber: number | null;
  /** Null before a successful receipt. */
  blocksLeft: number | null;
  secondsLeft: number | null;
}

export interface PaymentReturn {
  txHash: string;
  /** The payer's address the money went to. */
  to: string;
  amount: string;
  blockTime: string;
}

export const DEPOSIT_STATUSES = ["detected", "confirmed"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

/** A transfer to an option's receive address, in its token's base units. */
export interface Deposit {
  txHash: string;
  logIndex: number;
  from: string;
  amount: string;
  blockNumber: number;
  blockTime: string;
  /** confirmed once its block is final. */
  status: DepositStatus;
  /** Sent after the close: held for the payer unless the owner reopens the invoice. */
  late: boolean;
  /** The part booked to the owner; null until the ledger books it. */
  paid: string | null;
  blocksLeft: number;
  blocksTotal: number;
  secondsLeft: number;
}

/** Totals of every transfer, beyond the deposits a read lists. */
export interface DepositSummary {
  count: number;
  onTimeAmount: string;
  lateAmount: string;
  /** On time, and not booked yet. */
  pendingAmount: string;
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

/**
 * An invoice as its owner's list returns it. With several options, the terms and statuses are the current option's:
 * the one that received money first, else the first.
 */
export interface Invoice extends OptionFees {
  amounts?: PaymentAmounts;
  purpose: PaymentPurpose;
  documentKind: DocumentKind;
  linkId?: string;
  invoiceId: string;
  payToken: string | null;
  /** The option the terms are in; invoiceId for a fixed invoice. */
  optionId: string;
  /** An option's final payments reached 1.00 USD: money sent to any other option is held for the payer. */
  optionLocked: boolean;
  /** The option the payer last picked with Show address; only payments decide the option. */
  pickedOptionId: string | null;
  optionCount: number;
  /** A payment made before the close is not final yet; show a partially_paid invoice as confirming. */
  confirming: boolean;
  /** The checkout closed unpaid; paymentStatus turns expired once the chain is final. */
  closed: boolean;
  /** Null for a payment-link invoice before its first deposit. */
  number: number | null;
  title: string | null;
  note: string | null;
  dueDate: string | null;
  supplyDate: string | null;
  reference: string | null;
  /** A price agreed in fiat; amount is in the currency's minor units. */
  agreedValue: { currency: string; amount: string; decimals: number; date: string } | null;
  client: {
    name: string | null;
    email: string | null;
    address: string | null;
    country: string | null;
    taxId: string | null;
  };
  /** A merchant invoice's store. */
  store?: { storeId: string; name: string };
  metadata: Record<string, string>;
  brand: { storeId: string; color: string | null; logoAt: string | null } | null;
  /** The profile's billing details when the invoice was made. */
  issuer: {
    name: string;
    address: string;
    country: string;
    taxId: string | null;
    email: string;
  } | null;
  senderName: string | null;
  returnUrl: string | null;
  chainId: number;
  livemode: boolean;
  token: string;
  amount: string;
  /** The profile wallet that settlement pays. */
  recipient: string;
  factory: string;
  receiveAddress: string;
  expiresAt: string;
  closesAt: string;
  settleDeadline: string;
  paymentStatus: PaymentStatus;
  settlementStatus: SettlementStatus;
  refundStatus: RefundStatus;
  /** The list's state filter matches it. */
  state: PaymentState;
  wallet: WalletState;
  settlementTxHash: string | null;
  createdAt: string;
}

/** A token and network an invoice accepts, with its own id, amount and receive address. */
export interface InvoiceOption extends OptionFees {
  optionId: string;
  chainId: number;
  /** The chain's name, such as base-sepolia. */
  network: string;
  token: string;
  symbol: string;
  decimals: number;
  amount: string;
  receiveAddress: string;
  closesAt: string;
  amounts?: PaymentAmounts;
  depositSummary?: DepositSummary;
  /** On an option other than the shown one, they are held for the payer. */
  deposits: Deposit[];
}

/** The other invoice of a Revise; payToken is the replacement's pay link, null otherwise. */
export interface Revision {
  invoiceId: string;
  number: number;
  payToken: string | null;
}

/** An email to the client; sentAt and failedAt stay null while it waits. */
export interface InvoiceSend {
  requestedAt: string;
  sentAt: string | null;
  failedAt: string | null;
}

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

/** A change to an invoice; the fields its kind does not use are null. */
export interface InvoiceHistory {
  id: number;
  /** Such as invoice.created, invoice.paid or crosschain.converted. */
  kind: string;
  actor: HistoryActor;
  at: string;
  optionId: string | null;
  /** In asset's base units when asset is set, else in the option's token. */
  amount: string | null;
  /** The 1Click asset a cross-chain amount is in. */
  asset: string | null;
  txHash: string | null;
  step: ReminderStep | null;
  field: EditedField | null;
  from: string | null;
  to: string | null;
  until: string | null;
  related: Revision | null;
}

/** One invoice, as create, get, cancel, reopen, send and webhooks return it. */
export interface InvoiceDetails extends Invoice {
  paidAt: string | null;
  settledAt: string | null;
  canceledAt: string | null;
  depositSummary?: DepositSummary;
  /** At most 100 transfers, in chain order; depositSummary has the totals. */
  deposits: Deposit[];
  options: InvoiceOption[];
  /** Money in the base units of the option whose optionId is the invoiceId. */
  lines: PaymentDetails["items"];
  /** When Check status may run again; null when it may now. */
  nextCheckAt: string | null;
  /** The edits the payer sees, newest first; from and to are a due date's. */
  updates: { at: string; field: UpdateField; from: string | null; to: string | null }[];
  replacedBy: Revision | null;
  replaces: Revision | null;
  /** A payment through NEAR Intents. */
  crossChain: CrossChain | null;
  /** The payee takes payments from other chains (R-240). */
  crossChainOn: boolean;
  /** Why paid money has not reached the profile wallet yet; null when it is not waiting. */
  settlementWait: { kind: SettlementWait; until: string | null; secondsLeft: number | null } | null;
  sends: InvoiceSend[];
  reminders: {
    on: boolean;
    stoppedAt: string | null;
    emails: (InvoiceSend & { step: ReminderStep })[];
  };
  /** Null when the invoice doesn't repeat. */
  retainer: {
    endDate: string | null;
    nextDueDate: string | null;
    nextOn: string | null;
    stoppedAt: string | null;
  } | null;
  /** Newest first. */
  history: InvoiceHistory[];
  /** Pay page loads. */
  views: { count: number; firstAt: string | null; lastAt: string | null };
  memo: string | null;
  /** The close a reopen would give now; null when it can't reopen. */
  reopenUntil: string | null;
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
  data: { invoice: InvoiceDetails; held: Held | null };
}

/** The owner's check of an endpoint: it names no invoice. */
export interface TestWebhookEvent {
  id: string;
  type: "webhook.test";
  livemode: boolean;
  timestamp: string;
  data: Record<string, never>;
}
