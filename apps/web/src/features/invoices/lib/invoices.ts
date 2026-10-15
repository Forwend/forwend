import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import { activityStatus } from "@/features/activity/lib/activity";
import {
  AMOUNT_ERRORS,
  EXPIRY_BOUNDS_S,
  INVOICE_EXCEPTIONS,
  INVOICE_FIELDS,
  INVOICE_TIMELINE,
  PAY_WITH,
} from "@/features/invoices/constants/invoices";
import type {
  AmountError,
  Deposit,
  Invoice,
  InvoiceClient,
  InvoiceException,
  InvoiceField,
  InvoicePdf,
  InvoiceStart,
  InvoiceSummary,
} from "@/features/invoices/types/invoices";
import { API_BASE } from "@/shared/config/api";

/** 1 is INV-0001. */
export function invoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

export function invoicePdfUrl(invoiceId: string, pdf: InvoicePdf): string {
  return `${API_BASE}/v1/invoices/${encodeURIComponent(invoiceId)}/${pdf}.pdf`;
}

export function tokenKey(t: { chainId: number; token: string }): string {
  return `${t.chainId}:${t.token.toLowerCase()}`;
}

/**
 * The status pill: settled once the money reached the wallet, otherwise the payment status. A partly paid invoice
 * whose next payment still confirms reads as confirming, like a full payment awaiting finality (R-69).
 */
export function invoiceStatus(inv: InvoiceSummary): PaymentStatus {
  const partlyConfirming =
    inv.confirming && inv.paymentStatus === API_PAYMENT_STATUSES.partiallyPaid;
  return activityStatus({
    kind: ACTIVITY_KINDS.invoice,
    status: partlyConfirming ? API_PAYMENT_STATUSES.detected : inv.paymentStatus,
    settlementStatus: inv.settlementStatus,
    closed: inv.closed,
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
  // Waiting is done once money is seen, and Detected with it: a seen payment is already confirming.
  const done = settled
    ? 5
    : inv.paymentStatus === API_PAYMENT_STATUSES.paid
      ? 4
      : confirming.length > 0
        ? 2
        : deposits.length > 0
          ? 3
          : 0;
  // Closed (R-77) and canceled (R-79) take no more money: nothing moves.
  const ended =
    settled ||
    inv.closed ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expired ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid ||
    inv.paymentStatus === API_PAYMENT_STATUSES.canceled;
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

const EXCEPTIONS: Partial<Record<PaymentStatus, InvoiceException["kind"]>> = {
  [PAYMENT_STATUS.canceled]: INVOICE_EXCEPTIONS.canceled,
  [PAYMENT_STATUS.expired]: INVOICE_EXCEPTIONS.closedUnpaid,
  [PAYMENT_STATUS.expiredPartiallyPaid]: INVOICE_EXCEPTIONS.closedPartial,
};

/**
 * The next step the owner's page names under `status` (invoiceStatus), with the shown option's amounts. Money after
 * the checkout closed is late and held for the payer (D-26), whatever the status.
 */
export function invoiceException(inv: Invoice, status: PaymentStatus): InvoiceException {
  const sum = (late: boolean) =>
    inv.deposits.filter((d) => d.late === late).reduce((s, d) => s + BigInt(d.amount), 0n);
  const received = sum(false);
  const left = BigInt(inv.amount) - received;
  return {
    kind: EXCEPTIONS[status] ?? null,
    received,
    left: left > 0n ? left : 0n,
    late: sum(true),
  };
}

/**
 * A new invoice's form filled from a closed one: the same client and accepted options, and the whole amount or only
 * what is left. A closed invoice is never reopened (D-25). Payer-chooses amounts are USD at 1 per token (D-75). It stays
 * payer chooses unless money arrived on time: a late payment also locks an option, but the client never paid with it.
 */
export function restartFrom(
  inv: Invoice,
  client: InvoiceClient | undefined,
  rest: boolean,
): InvoiceStart {
  const decimals = inv.options.find((o) => o.optionId === inv.optionId)?.decimals ?? 0;
  const { received, left } = invoiceException(inv, PAYMENT_STATUS.expiredPartiallyPaid);
  const units = rest ? left : BigInt(inv.amount);
  return {
    payWith: inv.options.length > 1 && received === 0n ? PAY_WITH.any : PAY_WITH.fixed,
    picked: tokenKey(inv),
    amount: decimalText(units, decimals),
    client: {
      name: client?.name ?? "",
      email: client?.email ?? "",
      address: client?.address ?? "",
    },
  };
}
