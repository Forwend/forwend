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
  DUE_GRACE_DAYS,
  EXPIRY_BOUNDS_S,
  EXPIRY_CHOICES,
  INVOICE_EXCEPTIONS,
  INVOICE_FIELDS,
  INVOICE_TIMELINE,
  LINE_ERRORS,
  LINE_LIMITS,
  PAY_WITH,
  RESTART_PARAMS,
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
  LineDraft,
  LineError,
  LineField,
} from "@/features/invoices/types/invoices";
import { API_BASE } from "@/shared/config/api";
import { APP_ROUTES } from "@/shared/config/routes";

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

/**
 * One line item as typed (R-88): its unit price and total in base units, or what is wrong with it. The quantity has up
 * to 2 decimals, so the total is the price in hundredths of a quantity, and it must come out in whole base units. A
 * price of 0 is a free line.
 */
export function lineUnits(
  line: Pick<LineDraft, "description" | "quantity" | "price">,
  decimals: number,
): { price: bigint; units: bigint } | LineError {
  const description = line.description.trim();
  if (!description || description.length > LINE_LIMITS.description) return LINE_ERRORS.description;
  const quantity = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(line.quantity.trim());
  const hundredths = quantity ? BigInt(`${quantity[1]}${(quantity[2] ?? "").padEnd(2, "0")}`) : 0n;
  if (hundredths === 0n || hundredths > BigInt(LINE_LIMITS.quantityMax) * 100n)
    return LINE_ERRORS.quantity;
  const price = parseTokenAmount(line.price, decimals);
  if (typeof price === "string" && price !== AMOUNT_ERRORS.zero) return LINE_ERRORS.price;
  const units = typeof price === "string" ? 0n : price;
  if ((units * hundredths) % 100n !== 0n) return LINE_ERRORS.exact;
  return { price: units, units: (units * hundredths) / 100n };
}

/** The field a line's problem belongs to. */
export function lineErrorField(error: LineError): LineField {
  return error === LINE_ERRORS.exact ? LINE_ERRORS.price : error;
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

const DAY_MS = 86_400_000;

/** The day `days` after a YYYY-MM-DD day, as YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The day a checkout first needs to stay open to for a due date (D-80): the due date plus the grace days. */
export function dueCheckoutTarget(dueDate: string): string {
  return addDays(dueDate, DUE_GRACE_DAYS);
}

/**
 * The close day the form sets for a due date: its target, or the last day a checkout can reach (D-18) when the target
 * is further away. The day before the 365th, so the close time on it stays within 365 days of now.
 */
export function dueCheckoutDate(dueDate: string, today: string): string {
  const target = dueCheckoutTarget(dueDate);
  const latest = addDays(today, EXPIRY_BOUNDS_S.max / EXPIRY_CHOICES.day - 1);
  return target < latest ? target : latest;
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

const DUE_DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** As formatDueDate, without the year when it is the reader's current year: for rows with little room. */
export function formatDueDateShort(date: string, now: Date): string {
  return date.startsWith(`${now.getFullYear()}-`)
    ? DUE_DAY.format(new Date(`${date}T00:00:00Z`))
    : formatDueDate(date);
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

/** "7.50" as people write it: 7.5, and "2.00" as 2. The API gives quantities with 2 decimals. */
export function shortQuantity(quantity: string): string {
  return quantity.replace(/\.?0+$/, "");
}

/** New invoice filled from this invoice (R-91), or with only what is left of a closed one (R-77). */
export function invoiceCopyHref(invoiceId: string, rest: boolean): string {
  return `${APP_ROUTES.newInvoice}?${RESTART_PARAMS.from}=${invoiceId}${rest ? `&${RESTART_PARAMS.rest}=1` : ""}`;
}

/**
 * A new invoice's form filled from an earlier one (R-91, R-77): its client, reference, title, note, return link and
 * accepted options, with the whole amount and its items, or only what is left of a closed one and no items, which would
 * not add up to it. Dates are the new invoice's own. An invoice is never reopened (D-25). Payer-chooses amounts are USD
 * at 1 per token (D-75). The rest is asked in the token the client paid with on time; a late payment also locks an
 * option, but the client never paid with it.
 */
export function restartFrom(
  inv: Invoice,
  client: InvoiceClient | undefined,
  rest: boolean,
): InvoiceStart {
  const decimals = inv.options.find((o) => o.optionId === inv.optionId)?.decimals ?? 0;
  const { received, left } = invoiceException(inv, PAYMENT_STATUS.expiredPartiallyPaid);
  const units = rest ? left : BigInt(inv.amount);
  // Lines are in the base units of the invoice's own option (R-88).
  const lineDecimals = inv.options.find((o) => o.optionId === inv.invoiceId)?.decimals ?? decimals;
  return {
    payWith: inv.options.length > 1 && !(rest && received > 0n) ? PAY_WITH.any : PAY_WITH.fixed,
    picked: tokenKey(inv),
    amount: decimalText(units, decimals),
    items: rest
      ? []
      : inv.lines.map((line, i) => ({
          id: String(i),
          description: line.description,
          quantity: shortQuantity(line.quantity),
          price: decimalText(BigInt(line.unitPrice), lineDecimals),
        })),
    title: inv.title ?? "",
    note: inv.note ?? "",
    returnUrl: inv.returnUrl ?? "",
    reference: inv.reference ?? "",
    client: {
      name: client?.name ?? "",
      email: client?.email ?? "",
      address: client?.address ?? "",
      country: client?.country ?? "",
      taxId: client?.taxId ?? "",
    },
  };
}
