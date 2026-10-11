import type { PaymentStatus } from "@forwend/ui-web";
import {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
  type ApiDepositStatus,
  type ApiPaymentStatus,
  type ApiSettlementStatus,
  activityStatus,
} from "@/features/activity/activity";
import type { TokenBalance } from "@/features/balances/balances";
import { API_BASE } from "@/shared/config/api";

export const INVOICES_PAGE_SIZE = 20;

/** Checkout expiry choices in seconds, within the API's 900 to 31536000. */
export const EXPIRY_CHOICES = {
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
} as const;

export const DEFAULT_EXPIRY: ExpiryChoice = "week";

/** The API's text limits in characters (openapi.yaml, CreateInvoiceRequest). */
export const INVOICE_LIMITS = {
  title: 200,
  note: 2000,
  clientName: 200,
  clientEmail: 254,
  clientAddress: 500,
  senderName: 100,
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
  senderName: "senderName",
} as const;

export const AMOUNT_ERRORS = {
  format: "format",
  decimals: "decimals",
  zero: "zero",
} as const;

export const INVOICE_STEPS = {
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

export type ExpiryChoice = keyof typeof EXPIRY_CHOICES;
export type InvoiceField = (typeof INVOICE_FIELDS)[keyof typeof INVOICE_FIELDS];
export type AmountError = (typeof AMOUNT_ERRORS)[keyof typeof AMOUNT_ERRORS];
export type InvoiceStep = (typeof INVOICE_STEPS)[keyof typeof INVOICE_STEPS];
export type InvoicePdf = (typeof INVOICE_PDFS)[keyof typeof INVOICE_PDFS];

/** An enabled token, as GET /v1/profiles/{id}/balances lists it. */
export type InvoiceToken = Pick<TokenBalance, "chainId" | "token" | "symbol" | "decimals">;

export interface InvoiceClient {
  name: string | null;
  email: string | null;
  address: string | null;
}

/** The profile's billing details as they were when the invoice was made. */
export interface InvoiceIssuer {
  name: string;
  address: string;
  country: string;
  taxId: string | null;
  email: string;
}

export interface Deposit {
  txHash: string;
  logIndex: number;
  from: string;
  /** Base units. */
  amount: string;
  blockNumber: number;
  blockTime: string;
  status: ApiDepositStatus | (string & {});
  /** Paid after expiry: held for the payer, never the creator's. */
  late: boolean;
  blocksLeft: number;
  secondsLeft: number;
}

/** openapi.yaml, InvoiceSummary. */
export interface InvoiceSummary {
  invoiceId: string;
  number: number;
  title: string | null;
  note: string | null;
  /** YYYY-MM-DD; shown only, payment closes at expiresAt. */
  dueDate: string | null;
  /** Only in the owner's answers (create, list and the profile's read); the public GET leaves it out. */
  client?: InvoiceClient;
  issuer: InvoiceIssuer | null;
  /** The name the payer sees when there is no issuer, such as on a personal profile's request. */
  senderName: string | null;
  chainId: number;
  token: string;
  /** Base units. */
  amount: string;
  /** The profile wallet that settlement pays. */
  recipient: string;
  receiveAddress: string;
  expiresAt: string;
  settleDeadline: string;
  paymentStatus: ApiPaymentStatus | (string & {});
  settlementStatus: ApiSettlementStatus | (string & {});
  settlementTxHash: string | null;
  createdAt: string;
}

/** An invoice read alone or just created. */
export interface Invoice extends InvoiceSummary {
  /** Once paid: the block time of the deposit that completed the amount. */
  paidAt: string | null;
  /** Once settled: when the settlement was recorded as final. */
  settledAt: string | null;
  deposits: Deposit[];
}

export interface InvoicesPage {
  items: InvoiceSummary[];
  nextCursor: string | null;
}

export interface CreateInvoiceBody {
  chainId: number;
  token: string;
  amount: string;
  expiresIn: number;
  title: string;
  note: string;
  dueDate: string;
  senderName: string;
  client: { name: string; email: string; address: string };
}

/** 1 is INV-0001. */
export function invoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

/** Fraction digits that show the amount exactly: at least 2, more only when the amount has them. */
export function exactDigits(baseUnits: bigint, decimals: number): number {
  const fraction = (baseUnits % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return Math.min(decimals, Math.max(2, fraction.replace(/0+$/, "").length));
}

export function invoicePdfUrl(invoiceId: string, pdf: InvoicePdf): string {
  return `${API_BASE}/v1/invoices/${encodeURIComponent(invoiceId)}/${pdf}.pdf`;
}

export function tokenKey(t: { chainId: number; token: string }): string {
  return `${t.chainId}:${t.token.toLowerCase()}`;
}

/** The status pill: settled once the money reached the wallet, otherwise the payment status. */
export function invoiceStatus(inv: InvoiceSummary): PaymentStatus {
  return activityStatus({
    kind: ACTIVITY_KINDS.invoice,
    status: inv.paymentStatus,
    settlementStatus: inv.settlementStatus,
  });
}

/**
 * A typed amount in base units, exact: only digits with at most one point, never through a float. A comma is refused
 * rather than guessed: "12,50" could mean 12.50 or 1250.
 */
export function parseTokenAmount(text: string, decimals: number): bigint | AmountError {
  const match = /^(\d*)\.?(\d*)$/.exec(text.trim());
  if (!match || (!match[1] && !match[2])) return AMOUNT_ERRORS.format;
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > decimals) return AMOUNT_ERRORS.decimals;
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  return units === 0n ? AMOUNT_ERRORS.zero : units;
}

// The API's 422 names the field only in its message: "invalid invoice request: client.email must be …".
export function invalidField(message: string): InvoiceField | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return Object.values(INVOICE_FIELDS).find((field) => field === name) ?? null;
}

/**
 * How far the invoice got: the number of steps done and the step in progress (none once settled or expired). While a
 * payment confirms, the blocks and seconds left are the slowest deposit's.
 */
export function invoiceProgress(inv: Invoice) {
  // A late deposit is held for the payer and moves the invoice no further.
  const deposits = inv.deposits.filter((d) => !d.late);
  const confirming = deposits.filter((d) => d.status !== API_DEPOSIT_STATUSES.confirmed);
  const settled = inv.settlementStatus === API_SETTLEMENT_STATUSES.settled;
  const done = settled
    ? 4
    : inv.paymentStatus === API_PAYMENT_STATUSES.paid
      ? 3
      : confirming.length > 0
        ? 1
        : deposits.length > 0
          ? 2
          : 0;
  const ended =
    settled ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expired ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid;
  return {
    done,
    current: ended ? null : (INVOICE_TIMELINE[done] ?? null),
    blocksLeft: Math.max(0, ...confirming.map((d) => d.blocksLeft)),
    secondsLeft: Math.max(0, ...confirming.map((d) => d.secondsLeft)),
  };
}

/**
 * How far confirming got, 0 to 1, against the most blocks left seen while watching: the API gives no starting count.
 * Null until a block passes, so the bar never shows progress nobody saw.
 */
export function confirmingProgress(blocksLeft: number, mostBlocksLeft: number): number | null {
  return blocksLeft < mostBlocksLeft ? 1 - blocksLeft / mostBlocksLeft : null;
}

const DUE_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

/** A YYYY-MM-DD date as that same day wherever the reader is. */
export function formatDueDate(date: string): string {
  return DUE_DATE.format(new Date(`${date}T00:00:00Z`));
}
