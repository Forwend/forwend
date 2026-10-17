import { CLIENT_LIMITS } from "@/features/clients/constants/clients";
import type { ExpiryChoice } from "@/features/invoices/types/invoices";

export const INVOICES_PAGE_SIZE = 20;

/** Checkout expiry choices in seconds, within the API's 900 to 31536000. */
export const EXPIRY_CHOICES = {
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
} as const;

export const DEFAULT_EXPIRY: ExpiryChoice = "week";

/** Checkout closes at a date and time the creator picks, within the API's bounds (R-58). */
export const CUSTOM_EXPIRY = "custom";
export const EXPIRY_BOUNDS_S = { min: 900, max: 31_536_000 } as const;

/** D-80: with a due date the checkout stays open this many days past it, so a client who pays late still pays. */
export const DUE_GRACE_DAYS = 60;

/** How the payer pays (R-56): any enabled stablecoin and network, or one the creator fixes. */
export const PAY_WITH = { any: "any", fixed: "fixed" } as const;

/** GET /v1/profiles/{id}/events kinds (R-81), the same as the owner's email (R-80). */
export const INVOICE_EVENTS = {
  paid: "invoice.paid",
  settled: "invoice.settled",
  held: "invoice.held",
} as const;

/** The rows of Owed to you (R-95), in the API's order. */
export const OWED_KINDS = {
  overdue: "overdue",
  partlyPaid: "partlyPaid",
  held: "held",
} as const;

/** The states whose owner page says what to do next (R-77). */
export const INVOICE_EXCEPTIONS = {
  canceled: "canceled",
  closedUnpaid: "closedUnpaid",
  closedPartial: "closedPartial",
} as const;

/**
 * `?from=<invoiceId>` fills a new invoice from that one (R-91); `rest` asks only for what is left of a closed one (R-77,
 * D-25).
 */
export const RESTART_PARAMS = { from: "from", rest: "rest" } as const;

/**
 * The currencies an agreed value can be in (R-93), with their ISO 4217 decimals: EUR and the ones the ECB publishes a
 * daily reference rate for (D-82). A copy of the API's invoice.AgreedCurrencies; a Go test fails when either changes
 * alone.
 */
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

/** The API's text limits in characters (openapi.yaml, CreateInvoiceRequest). */
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
} as const;

/** Form fields as the API names them in a 422 message. */
export const INVOICE_FIELDS = {
  amount: "amount",
  title: "title",
  note: "note",
  dueDate: "dueDate",
  supplyDate: "supplyDate",
  reference: "reference",
  // The API names them so in its 422 (R-93).
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
  // The API's word on the lines as a whole (R-88).
  lines: "lines",
} as const;

export const AMOUNT_ERRORS = {
  format: "format",
  decimals: "decimals",
  zero: "zero",
} as const;

/** R-88: the API's line item limits, and what can be wrong with one line as typed. */
export const LINE_LIMITS = { count: 50, description: 200, quantityMax: 1_000_000 } as const;
export const LINE_ERRORS = {
  description: "description",
  quantity: "quantity",
  price: "price",
  // Quantity times price is not a whole number of the token's smallest unit.
  exact: "exact",
} as const;

export const INVOICE_STEPS = {
  waiting: "waiting",
  detected: "detected",
  confirming: "confirming",
  paid: "paid",
  settled: "settled",
} as const;

/** The timeline, in order. */
export const INVOICE_TIMELINE = Object.values(INVOICE_STEPS);

/** The PDFs the API draws; the receipt answers 409 until the invoice is paid. */
export const INVOICE_PDFS = {
  invoice: "invoice",
  receipt: "receipt",
} as const;

/** Why a paid invoice's money has not reached the profile wallet yet (openapi.yaml, Invoice.settlementWait). */
export const SETTLEMENT_WAITS = {
  signing: "signing",
  finalizing: "finalizing",
  retrying: "retrying",
  dailyLimit: "dailyLimit",
  refused: "refused",
} as const;
