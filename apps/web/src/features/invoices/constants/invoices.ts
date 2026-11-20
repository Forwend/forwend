import { CLIENT_LIMITS } from "@/features/clients/constants/clients";
import type {
  ExpiryChoice,
  HistoryCategory,
  HistoryKind,
} from "@/features/invoices/types/invoices";

export const INVOICES_PAGE_SIZE = 20;

export const PAYMENT_PURPOSES = {
  invoice: "invoice",
  checkout: "checkout",
  request: "request",
} as const;
export const DOCUMENT_KINDS = { invoice: "invoice", request: "request", none: "none" } as const;

/** In seconds, within the API's bounds. */
export const EXPIRY_CHOICES = {
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
} as const;

export const DEFAULT_EXPIRY: ExpiryChoice = "week";

export const CUSTOM_EXPIRY = "custom";
export const EXPIRY_BOUNDS_S = { min: 900, max: 31_536_000 } as const;

/** Days before its due date a repeat goes out: the API's RetainerLead. */
export const RETAINER_LEAD_DAYS = 7;

/** Days the checkout stays open past a due date, so a late client still pays. */
export const DUE_GRACE_DAYS = 60;

export const PAY_WITH = { any: "any", fixed: "fixed" } as const;

export const INVOICE_EVENTS = {
  paid: "invoice.paid",
  settled: "invoice.settled",
  held: "invoice.held",
} as const;

/** A payment status change is "invoice." and the new status. */
export const HISTORY_KINDS = {
  created: "invoice.created",
  canceled: "invoice.canceled",
  payerEmail: "payer.email_given",
  optionChosen: "payer.option_chosen",
  optionPicked: "payer.option_picked",
  open: "invoice.open", // a reorg dropped the only payment
  detected: "invoice.detected",
  partiallyPaid: "invoice.partially_paid",
  paid: INVOICE_EVENTS.paid,
  expired: "invoice.expired",
  expiredPartiallyPaid: "invoice.expired_partially_paid",
  held: INVOICE_EVENTS.held,
  settlementQueued: "invoice.settlement_queued",
  settled: INVOICE_EVENTS.settled,
  remindersOn: "reminders.on",
  remindersOff: "reminders.off",
  remindersStopped: "reminders.stopped",
  repeatStopped: "repeat.stopped",
  invoiceEmailed: "email.invoice_sent",
  invoiceEmailFailed: "email.invoice_failed",
  reminderEmailed: "email.reminder_sent",
  reminderEmailFailed: "email.reminder_failed",
  receiptEmailed: "email.receipt_sent",
  receiptEmailFailed: "email.receipt_failed",
  edited: "invoice.edited",
  replaced: "invoice.replaced",
  reopened: "invoice.reopened",
  numbered: "invoice.numbered",
  refunded: "invoice.refunded",
  returnQueued: "invoice.return_queued",
  returnReleased: "invoice.return_released",
  receiverSettled: "receiver.settled",
  checkoutCloseChanged: "checkout.close_changed",
  crossChainDeposit: "crosschain.deposit_seen",
  crossChainConverted: "crosschain.converted",
  crossChainRefunded: "crosschain.refunded",
  crossChainFailed: "crosschain.failed",
} as const;

/** The fields an invoice.edited row names. */
export const HISTORY_FIELDS = {
  memo: "memo",
  clientEmail: "clientEmail",
  returnUrl: "returnUrl",
  reference: "reference",
  note: "note",
  dueDate: "dueDate",
} as const;

/** Who made a history change; system is Forwend. */
export const HISTORY_ACTORS = { owner: "owner", payer: "payer", system: "system" } as const;

/** A kind the page doesn't know yet is a change. */
export const HISTORY_CATEGORIES = { payment: "payment", change: "change", email: "email" } as const;
export const HISTORY_CATEGORY_OF = {
  [HISTORY_KINDS.created]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.canceled]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.payerEmail]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.optionChosen]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.optionPicked]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.open]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.detected]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.partiallyPaid]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.paid]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.expired]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.expiredPartiallyPaid]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.held]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.settlementQueued]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.settled]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.remindersOn]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.remindersOff]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.remindersStopped]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.repeatStopped]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.invoiceEmailed]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.invoiceEmailFailed]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.reminderEmailed]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.reminderEmailFailed]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.receiptEmailed]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.receiptEmailFailed]: HISTORY_CATEGORIES.email,
  [HISTORY_KINDS.edited]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.replaced]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.reopened]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.numbered]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.refunded]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.returnQueued]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.returnReleased]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.receiverSettled]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.checkoutCloseChanged]: HISTORY_CATEGORIES.change,
  [HISTORY_KINDS.crossChainDeposit]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.crossChainConverted]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.crossChainRefunded]: HISTORY_CATEGORIES.payment,
  [HISTORY_KINDS.crossChainFailed]: HISTORY_CATEGORIES.payment,
} as const satisfies Record<HistoryKind, HistoryCategory>;

export const HISTORY_FILTERS = { all: "all", ...HISTORY_CATEGORIES } as const;

/** In the order they go out: 3 days before the due date, on it, 7 days after. */
export const REMINDER_STEPS = {
  before: "before",
  due: "due",
  after: "after",
} as const;

export const STOP_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The invoice id is keccak256 of it. */
export const PAY_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** In the API's order. */
export const OWED_KINDS = {
  overdue: "overdue",
  partlyPaid: "partlyPaid",
  held: "held",
} as const;

export const INVOICE_EXCEPTIONS = {
  canceled: "canceled",
  closedUnpaid: "closedUnpaid",
  closedPartial: "closedPartial",
} as const;

/** from copies an invoice; rest asks only for what is left of a closed one. */
export const RESTART_PARAMS = {
  from: "from",
  rest: "rest",
  revise: "revise",
  client: "client", // a saved client's id
} as const;

/** ISO 4217 decimals; copies the API's invoice.AgreedCurrencies, and a Go test checks both. */
export const AGREED_CURRENCIES = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  AUD: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  CZK: 2,
  DKK: 2,
  HKD: 2,
  HUF: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  ISK: 0,
  JPY: 0,
  KRW: 0,
  MXN: 2,
  MYR: 2,
  NOK: 2,
  NZD: 2,
  PHP: 2,
  PLN: 2,
  RON: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TRY: 2,
  ZAR: 2,
} as const;

/** The API's text limits in characters. */
export const INVOICE_LIMITS = {
  title: 200,
  note: 2000,
  clientName: CLIENT_LIMITS.name,
  clientEmail: CLIENT_LIMITS.email,
  clientAddress: CLIENT_LIMITS.address,
  clientTaxId: CLIENT_LIMITS.taxId,
  reference: CLIENT_LIMITS.reference,
  senderName: 100,
  returnUrl: 2000,
  memo: 2000,
} as const;

/** Form fields as the API names them in a 422 message. */
export const INVOICE_FIELDS = {
  amount: "amount",
  title: "title",
  note: "note",
  dueDate: "dueDate",
  supplyDate: "supplyDate",
  reference: "reference",
  agreedCurrency: "agreedValue.currency",
  agreedAmount: "agreedValue.amount",
  agreedDate: "agreedValue.date",
  clientName: "client.name",
  clientEmail: "client.email",
  clientAddress: "client.address",
  clientCountry: "client.country",
  clientTaxId: "client.taxId",
  senderName: "senderName",
  amountUsd: "amountUsd",
  expiresIn: "expiresIn",
  returnUrl: "returnUrl",
  memo: "memo",
  lines: "lines",
  reminders: "reminders",
  repeat: "repeat",
  repeatEndDate: "repeat.endDate",
} as const;

/** The API's line item limits. */
export const LINE_LIMITS = { count: 100, description: 200, quantityMax: 1_000_000 } as const;
export const LINE_ERRORS = {
  description: "description",
  quantity: "quantity",
  price: "price",
  exact: "exact", // qty × price isn't whole base units
} as const;

export const INVOICE_STEPS = {
  waiting: "waiting",
  detected: "detected",
  confirming: "confirming",
  paid: "paid",
  settled: "settled",
} as const;

export const INVOICE_TIMELINE = Object.values(INVOICE_STEPS);

/** In order: the last is In your wallet, or how it ended. */
export const RECORD_STEPS = {
  created: "created",
  sent: "sent",
  opened: "opened",
  paid: "paid",
  wallet: "wallet",
  closed: "closed",
  canceled: "canceled",
} as const;

export const RECORD_STEP_STATES = {
  done: "done",
  current: "current",
  upcoming: "upcoming",
  stopped: "stopped",
} as const;

/** The receipt answers 409 until the invoice is paid. */
export const INVOICE_PDFS = {
  invoice: "invoice",
  receipt: "receipt",
} as const;

export const SETTLEMENT_WAITS = {
  signing: "signing",
  finalizing: "finalizing",
  retrying: "retrying",
  dailyLimit: "dailyLimit",
  refused: "refused",
} as const;

export const RECONCILIATION_STATES = {
  verified: "verified",
  pending: "pending",
  review: "review",
} as const;

/** A personal profile's request has no customer step. */
export const STEP_IDS = {
  customer: "customer",
  items: "items",
  details: "details",
  review: "review",
} as const;

export const INVOICE_STEP_IDS = [
  STEP_IDS.customer,
  STEP_IDS.items,
  STEP_IDS.details,
  STEP_IDS.review,
] as const;

export const REQUEST_STEPS = [STEP_IDS.items, STEP_IDS.details, STEP_IDS.review] as const;
