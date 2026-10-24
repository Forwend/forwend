import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import { activityStatus } from "@/features/activity/lib/activity";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import {
  AGREED_CURRENCIES,
  AMOUNT_ERRORS,
  DEFAULT_EXPIRY,
  DUE_GRACE_DAYS,
  EXPIRY_BOUNDS_S,
  EXPIRY_CHOICES,
  INVOICE_EXCEPTIONS,
  INVOICE_FIELDS,
  INVOICE_TIMELINE,
  LINE_ERRORS,
  LINE_LIMITS,
  OWED_KINDS,
  PAY_WITH,
  RESTART_PARAMS,
} from "@/features/invoices/constants/invoices";
import type {
  AgreedValue,
  AmountError,
  Deposit,
  ExpiryChoice,
  Invoice,
  InvoiceClient,
  InvoiceException,
  InvoiceField,
  InvoicePdf,
  InvoiceReminders,
  InvoiceStart,
  InvoiceSummary,
  LineDraft,
  LineError,
  LineField,
  Owed,
} from "@/features/invoices/types/invoices";
import type { TokenRef } from "@/features/profiles/types/tokens";
import { API_BASE } from "@/shared/config/api";
import { APP_ROUTES } from "@/shared/config/routes";

export function invoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

export function invoicePdfUrl(payToken: string, pdf: InvoicePdf): string {
  return `${API_BASE}/v1/invoices/${encodeURIComponent(payToken)}/${pdf}.pdf`;
}

export function tokenKey(t: { chainId: number; token: string }): string {
  return `${t.chainId}:${t.token.toLowerCase()}`;
}

/** A partly paid invoice whose next payment still confirms reads as confirming (R-69). */
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

/** Exact, never through a float. A comma is refused, not guessed: "12,50" could mean 12.50 or 1250. */
export function parseTokenAmount(text: string, decimals: number): bigint | AmountError {
  const match = /^(\d*)\.?(\d*)$/.exec(text.trim());
  if (!match || (!match[1] && !match[2])) return AMOUNT_ERRORS.format;
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > decimals) return AMOUNT_ERRORS.decimals;
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  return units === 0n ? AMOUNT_ERRORS.zero : units;
}

/** R-88: quantity has 2 decimals, so the total must come out in whole base units; a price of 0 is free. */
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

export function lineErrorField(error: LineError): LineField {
  return error === LINE_ERRORS.exact ? LINE_ERRORS.price : error;
}

/** R-93. */
export function agreedDigits(currency: string): number | undefined {
  return (AGREED_CURRENCIES as Record<string, number>)[currency];
}

/** R-93. */
export function formatAgreed(agreed: AgreedValue): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: agreed.currency,
    minimumFractionDigits: agreed.decimals,
    maximumFractionDigits: agreed.decimals,
  }).format(Number(decimalText(BigInt(agreed.amount), agreed.decimals)));
}

export function currencyOptions(codes: readonly string[]): { value: string; label: string }[] {
  const names = new Intl.DisplayNames(undefined, { type: "currency" });
  return codes.map((code) => ({ value: code, label: `${code} · ${names.of(code) ?? code}` }));
}

/** A plain decimal, as the API reads amountUsd: 12500000 at 6 is "12.5". */
export function decimalText(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${units / scale}.${fraction}` : `${units / scale}`;
}

/** Null when either is missing or the result is outside the API's 15 minutes to 365 days. */
export function customExpiresIn(date: string, time: string, now: number): number | null {
  const at = Date.parse(`${date}T${time}`);
  if (!date || !time || Number.isNaN(at)) return null;
  const seconds = Math.round((at - now) / 1000);
  return seconds >= EXPIRY_BOUNDS_S.min && seconds <= EXPIRY_BOUNDS_S.max ? seconds : null;
}

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** D-80. */
export function dueCheckoutTarget(dueDate: string): string {
  return addDays(dueDate, DUE_GRACE_DAYS);
}

/** Capped at the day before the 365th (D-18), so the close time on it stays within 365 days. */
export function dueCheckoutDate(dueDate: string, today: string): string {
  const target = dueCheckoutTarget(dueDate);
  const latest = addDays(today, EXPIRY_BOUNDS_S.max / EXPIRY_CHOICES.day - 1);
  // biome-ignore lint/complexity/useMathMinMax: ISO date strings; Math.min would give NaN
  return target < latest ? target : latest;
}

/** As the API accepts for returnUrl. */
export function isReturnLink(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.host !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** R-136: the tokens not in off; all of them when off would leave none, and the API then says why. */
export function tokensOn<T extends TokenRef>(
  tokens: readonly T[],
  off: readonly TokenRef[],
): readonly T[] {
  const on = tokens.filter(
    (t) => !off.some((o) => o.chainId === t.chainId && o.token === t.token.toLowerCase()),
  );
  return on.length > 0 ? on : tokens;
}

/** The choice whose seconds a store's default close has (R-134); New invoice's default otherwise. */
export function expiryChoice(seconds: number | undefined): ExpiryChoice {
  const choices = Object.entries(EXPIRY_CHOICES) as [ExpiryChoice, number][];
  return choices.find(([, value]) => value === seconds)?.[0] ?? DEFAULT_EXPIRY;
}

/** R-134: the API refused a merchant invoice's return link for its store's origins, not for its form. */
export function offStoreOrigins(message: string): boolean {
  return invalidField(message) === INVOICE_FIELDS.returnUrl && message.includes("allowed origins");
}

// The API's 422 names the field only in its message: "invalid invoice request: client.email must be …".
export function invalidField(message: string): InvoiceField | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return Object.values(INVOICE_FIELDS).find((field) => field === name) ?? null;
}

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

function slowest(deposits: readonly Deposit[]) {
  const last = deposits.reduce<Deposit | null>(
    (most, d) => (most && most.blocksLeft >= d.blocksLeft ? most : d),
    null,
  );
  return { blocksLeft: last?.blocksLeft ?? 0, blocksTotal: last?.blocksTotal ?? 0 };
}

/** Null until a block passes, so the bar never shows progress nobody saw. */
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

/** Money after the checkout closed is late and held for the payer (D-26), whatever the status. */
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

/** The API gives quantities with 2 decimals, so trailing zeros are only fraction digits. */
export function shortQuantity(quantity: string): string {
  return quantity.replace(/\.?0+$/, "");
}

/** New invoice filled from this invoice (R-91), or with only what is left of a closed one (R-77). */
export function invoiceCopyHref(invoiceId: string, rest: boolean): string {
  return `${APP_ROUTES.newInvoice}?${RESTART_PARAMS.from}=${invoiceId}${rest ? `&${RESTART_PARAMS.rest}=1` : ""}`;
}

/** R-129: New invoice filled from this one, which it replaces once created. */
export function invoiceReviseHref(invoiceId: string): string {
  return `${APP_ROUTES.newInvoice}?${RESTART_PARAMS.from}=${invoiceId}&${RESTART_PARAMS.revise}=1`;
}

// R-91, R-77: a new invoice, never the old one topped up (D-25); payer-chooses amounts are USD at 1 per token (D-75).
// The rest is asked in the token paid with on time: a late payment also locks an option.
export function restartFrom(
  inv: Invoice,
  client: InvoiceClient | undefined,
  rest: boolean,
  reminders: InvoiceReminders | undefined,
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
    // The price agreed for the whole amount (R-93): it does not describe the rest.
    agreed:
      rest || !inv.agreedValue
        ? null
        : {
            currency: inv.agreedValue.currency,
            amount: decimalText(BigInt(inv.agreedValue.amount), inv.agreedValue.decimals),
            date: inv.agreedValue.date,
          },
    // Reminders the client stopped stay off on the copy (R-97); the rest of a closed invoice starts without them.
    reminders: !rest && !!reminders?.on && !reminders.stoppedAt,
    ...(inv.store ? { storeId: inv.store.storeId } : {}),
    client: {
      name: client?.name ?? "",
      email: client?.email ?? "",
      address: client?.address ?? "",
      country: client?.country ?? "",
      taxId: client?.taxId ?? "",
    },
  };
}

/** At 1 USD per stablecoin (D-75), in cents cut once, never rounded up. */
export function owedCents(items: readonly Owed[]): bigint {
  const unpaid = items.filter((o) => o.kind !== OWED_KINDS.held);
  if (unpaid.length === 0) return 0n;
  // Added at the finest decimals of any token, so no cent is lost per row.
  const finest = Math.max(...unpaid.map((o) => o.decimals));
  const sum = unpaid.reduce(
    (s, o) => s + BigInt(o.amount) * 10n ** BigInt(finest - o.decimals),
    0n,
  );
  return (sum * 10n ** BigInt(USD_DECIMALS)) / 10n ** BigInt(finest);
}
