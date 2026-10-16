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

/** The states whose owner page says what to do next (R-77). */
export const INVOICE_EXCEPTIONS = {
  canceled: "canceled",
  closedUnpaid: "closedUnpaid",
  closedPartial: "closedPartial",
} as const;

/** `?from=<invoiceId>` fills a new invoice from a closed one; `rest` asks only for what is left (R-77, D-25). */
export const RESTART_PARAMS = { from: "from", rest: "rest" } as const;

/** The API's text limits in characters (openapi.yaml, CreateInvoiceRequest). */
export const INVOICE_LIMITS = {
  title: 200,
  note: 2000,
  clientName: CLIENT_LIMITS.name,
  clientEmail: CLIENT_LIMITS.email,
  clientAddress: CLIENT_LIMITS.address,
  clientTaxId: CLIENT_LIMITS.taxId,
  senderName: 100,
  returnUrl: 2000,
} as const;

/** Form fields as the API names them in a 422 message. */
export const INVOICE_FIELDS = {
  amount: "amount",
  title: "title",
  note: "note",
  dueDate: "dueDate",
  clientName: "client.name",
  clientEmail: "client.email",
  clientAddress: "client.address",
  clientCountry: "client.country",
  clientTaxId: "client.taxId",
  senderName: "senderName",
  amountUsd: "amountUsd",
  expiresIn: "expiresIn",
  returnUrl: "returnUrl",
} as const;

export const AMOUNT_ERRORS = {
  format: "format",
  decimals: "decimals",
  zero: "zero",
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
