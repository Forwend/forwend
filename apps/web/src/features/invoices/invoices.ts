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

/** Checkout closes at a date and time the creator picks, within the API's bounds (R-58). */
export const CUSTOM_EXPIRY = "custom";
export const EXPIRY_BOUNDS_S = { min: 900, max: 31_536_000 } as const;

/** How the payer pays (R-56): any enabled stablecoin and network, or one the creator fixes. */
export const PAY_WITH = { any: "any", fixed: "fixed" } as const;
export type PayWith = (typeof PAY_WITH)[keyof typeof PAY_WITH];

/** The API's text limits in characters (openapi.yaml, CreateInvoiceRequest). */
export const INVOICE_LIMITS = {
  title: 200,
  note: 2000,
  clientName: 200,
  clientEmail: 254,
  clientAddress: 500,
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
  /** The blocks it had to wait when first seen, fixed across reads: blocksTotal - blocksLeft have passed (R-73). */
  blocksTotal: number;
  secondsLeft: number;
}

/** openapi.yaml, InvoiceSummary. */
export interface InvoiceSummary {
  /** The pay link's id. */
  invoiceId: string;
  /** The on-chain id in the terms below: invoiceId, or the chosen or first option's of a payer-chooses invoice. */
  optionId: string;
  /** An option received money, so the payer can't pick another (R-56). */
  optionLocked: boolean;
  /** How many tokens and networks it accepts; 1 for a fixed invoice. */
  optionCount: number;
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
  /** The creator's https link, offered to the payer once paid (R-58). */
  returnUrl: string | null;
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

/** Why a paid invoice's money has not reached the profile wallet yet (openapi.yaml, Invoice.settlementWait). */
export const SETTLEMENT_WAITS = {
  signing: "signing",
  finalizing: "finalizing",
  retrying: "retrying",
  dailyLimit: "dailyLimit",
  refused: "refused",
} as const;
export type SettlementWaitKind = (typeof SETTLEMENT_WAITS)[keyof typeof SETTLEMENT_WAITS];

export interface SettlementWait {
  kind: SettlementWaitKind;
  /** retrying and dailyLimit: when the signer tries again. */
  until: string | null;
  /** finalizing: estimated chain time until the settle is final. */
  secondsLeft: number | null;
}

/** One token and network the invoice accepts, with its own on-chain id, amount and address (R-56). */
export interface InvoiceOption {
  optionId: string;
  chainId: number;
  /** The API's chain name, such as base-sepolia. */
  network: string;
  token: string;
  symbol: string;
  decimals: number;
  /** Base units. */
  amount: string;
  receiveAddress: string;
  /** On an option other than the shown one, these are held for the payer (D-76). */
  deposits: Deposit[];
}

/** An invoice read alone or just created. */
export interface Invoice extends InvoiceSummary {
  /** Every accepted option, the shown one included: one for a fixed invoice. */
  options: InvoiceOption[];
  /** Once paid: the block time of the deposit that completed the amount. */
  paidAt: string | null;
  /** Once settled: when the settlement was recorded as final. */
  settledAt: string | null;
  deposits: Deposit[];
  /** When Check status may run again; null when it may now (R-55). */
  nextCheckAt: string | null;
  /** Only in the owner's reads: null while not paid or once settled. */
  settlementWait?: SettlementWait | null;
}

/** POST /v1/invoices/{id}/recheck (R-55): what Check status found. Amounts in base units. */
export interface Recheck {
  onChain: string;
  recorded: string;
  rescanning: boolean;
  nextCheckAt: string;
  /** Chains of options whose network did not answer; the others were checked (F144). */
  unreadable: number[];
}

export interface InvoicesPage {
  items: InvoiceSummary[];
  nextCursor: string | null;
}

/** Fixed: chainId, token and amount; payer chooses: amountUsd alone (R-56). */
export interface CreateInvoiceBody {
  chainId?: number;
  token?: string;
  amount?: string;
  amountUsd?: string;
  returnUrl: string;
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

/** Units with `decimals` as a plain decimal, as the API reads amountUsd: 12500000 at 6 is "12.5". */
export function decimalText(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${units / scale}.${fraction}` : `${units / scale}`;
}

/**
 * Seconds from now to a local date (YYYY-MM-DD) and time (HH:MM), or null when either is missing or the result is
 * outside the API's 15 minutes to 365 days.
 */
export function customExpiresIn(date: string, time: string, now: number): number | null {
  const at = Date.parse(`${date}T${time}`);
  if (!date || !time || Number.isNaN(at)) return null;
  const seconds = Math.round((at - now) / 1000);
  return seconds >= EXPIRY_BOUNDS_S.min && seconds <= EXPIRY_BOUNDS_S.max ? seconds : null;
}

/** An https link with a host and no user or password, as the API accepts for returnUrl. */
export function isReturnLink(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.host !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
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
    ...slowest(confirming),
    secondsLeft: Math.max(0, ...confirming.map((d) => d.secondsLeft)),
  };
}

/** The blocks left and the blocks to wait of the deposit furthest from final. */
function slowest(deposits: readonly Deposit[]) {
  const last = deposits.reduce<Deposit | null>(
    (most, d) => (most && most.blocksLeft >= d.blocksLeft ? most : d),
    null,
  );
  return { blocksLeft: last?.blocksLeft ?? 0, blocksTotal: last?.blocksTotal ?? 0 };
}

/** How far confirming got, 0 to 1. Null until a block passes, so the bar never shows progress nobody saw. */
export function confirmingProgress(blocksLeft: number, blocksTotal: number): number | null {
  return blocksLeft < blocksTotal ? 1 - blocksLeft / blocksTotal : null;
}

const DUE_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

/** A YYYY-MM-DD date as that same day wherever the reader is. */
export function formatDueDate(date: string): string {
  return DUE_DATE.format(new Date(`${date}T00:00:00Z`));
}
