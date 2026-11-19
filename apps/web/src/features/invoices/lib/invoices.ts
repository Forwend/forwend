import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import {
  AMOUNT_ERRORS,
  INVOICE_EXCEPTIONS,
  INVOICE_FIELDS,
  INVOICE_TIMELINE,
  OWED_KINDS,
  PAY_WITH,
  RECORD_STEP_STATES,
  RECORD_STEPS,
  RESTART_PARAMS,
} from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type {
  AgreedValue,
  AmountError,
  Deposit,
  FeeTerms,
  Invoice,
  InvoiceClient,
  InvoiceException,
  InvoiceField,
  InvoiceOption,
  InvoicePdf,
  InvoiceReminders,
  InvoiceSend,
  InvoiceStart,
  InvoiceSummary,
  InvoiceViews,
  OptionFees,
  Owed,
  RecordStep,
  RecordStepState,
} from "@/features/invoices/types/invoices";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";
import type { TokenRef } from "@/features/profiles/types/tokens";
import { API_BASE } from "@/shared/config/api";
import { APP_ROUTES } from "@/shared/config/routes";
import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/shared/constants/payment-state";
import { paymentStatusOf } from "@/shared/lib/payment-state";

const DAY_MS = 86_400_000;

const PAYABLE: ReadonlySet<PaymentStatus> = new Set([
  PAYMENT_STATUS.open,
  PAYMENT_STATUS.overdue,
  PAYMENT_STATUS.partiallyPaid,
  PAYMENT_STATUS.detected,
  PAYMENT_STATUS.confirming,
]);

/** "" for a payment-link invoice before its first deposit. */
export function invoiceNumber(n: number | null): string {
  return n === null ? "" : `INV-${String(n).padStart(4, "0")}`;
}

export function invoicePdfUrl(payToken: string, pdf: InvoicePdf): string {
  return `${API_BASE}/v1/invoices/${encodeURIComponent(payToken)}/${pdf}.pdf`;
}

/** "" while rendered on the server. */
export function payLinkUrl(payToken: string): string {
  return typeof window === "undefined" ? "" : `${window.location.origin}/pay/${payToken}`;
}

export function tokenKey(t: { chainId: number; token: string }): string {
  return `${t.chainId}:${t.token.toLowerCase()}`;
}

/** Partly paid with a payment still confirming reads Confirming; open past its due date, Overdue. */
export function invoiceStatus(inv: InvoiceSummary): PaymentStatus {
  return paymentStatusOf({
    paymentStatus: inv.paymentStatus,
    confirming: inv.confirming,
    closed: inv.closed,
    state: inv.state,
    dueDate: inv.dueDate,
  });
}

/** Payable and not closed: money sent after the close is held for a refund. */
export function canStillBePaid(
  inv: Pick<InvoiceSummary, "closesAt">,
  status: PaymentStatus,
  now: Date,
): boolean {
  return PAYABLE.has(status) && Date.parse(inv.closesAt) > now.getTime();
}

/** Whole UTC days, as the API counts lateness: 0 today, negative once late. */
export function daysUntilDue(dueDate: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - today) / DAY_MS);
}

/** Exact, never through a float. A comma is refused: "12,50" could mean 12.50 or 1250. */
export function parseTokenAmount(text: string, decimals: number): bigint | AmountError {
  const match = /^(\d*)\.?(\d*)$/.exec(text.trim());
  if (!match || (!match[1] && !match[2])) return AMOUNT_ERRORS.format;
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > decimals) return AMOUNT_ERRORS.decimals;
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  return units === 0n ? AMOUNT_ERRORS.zero : units;
}
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

/** As the API accepts for returnUrl. */
export function isReturnLink(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.host !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** An empty result stays empty: disabled tokens never come back. */
export function tokensOn<T extends TokenRef>(
  tokens: readonly T[],
  off: readonly TokenRef[],
): readonly T[] {
  return tokens.filter(
    (t) => !off.some((o) => o.chainId === t.chainId && o.token === t.token.toLowerCase()),
  );
}

/** The API names a refused field only in its 422 message: "invalid invoice request: client.email …". */
export function refusedField(message: string): { field: InvoiceField; message: string } | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  const field = Object.values(INVOICE_FIELDS).find((f) => f === name);
  if (!field) return null;
  // A well-formed link outside the store's allowed origins.
  const offStore = field === INVOICE_FIELDS.returnUrl && message.includes("allowed origins");
  return {
    field,
    message: offStore ? NEW_INVOICE_COPY.returnOriginError : NEW_INVOICE_COPY.fieldErrors[field],
  };
}

export function invoiceProgress(inv: Invoice) {
  // A late deposit is held for the payer and moves the invoice no further.
  const deposits = (
    inv.optionLocked
      ? inv.deposits
      : inv.options.flatMap((o) => o.deposits).length > 0
        ? inv.options.flatMap((o) => o.deposits)
        : inv.deposits
  ).filter((d) => !d.late);
  const onChain = deposits.filter((d) => d.status !== API_DEPOSIT_STATUSES.confirmed);
  // Final on chain is not confirmed until the ledger books it (paid is set).
  const confirming = deposits.filter(
    (d) => d.status !== API_DEPOSIT_STATUSES.confirmed || d.paid === null,
  );
  const settled =
    inv.paymentStatus === API_PAYMENT_STATUSES.paid &&
    inv.settlementStatus === API_SETTLEMENT_STATUSES.settled;
  // A seen payment is already confirming, so Waiting and Detected are both done.
  const done = settled
    ? 5
    : inv.paymentStatus === API_PAYMENT_STATUSES.paid
      ? 4
      : confirming.length > 0
        ? 2
        : deposits.length > 0
          ? 3
          : 0;
  const ended =
    settled ||
    inv.closed ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expired ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid ||
    inv.paymentStatus === API_PAYMENT_STATUSES.canceled;
  return {
    done,
    current: ended ? null : (INVOICE_TIMELINE[done] ?? null),
    ...slowest(onChain),
    secondsLeft: Math.max(0, ...onChain.map((d) => d.secondsLeft)),
  };
}

/** Never a step ahead of the facts; the emailed step shows only once an email went out. */
export function recordSteps(
  inv: Invoice,
  sends: readonly InvoiceSend[],
  views: InvoiceViews | null,
): RecordStep[] {
  const sent = sends.find((s) => s.sentAt)?.sentAt ?? null;
  const paid = inv.paidAt !== null;
  const ended = !paid && (inv.canceledAt !== null || Date.parse(inv.closesAt) <= Date.now());
  return [
    { id: RECORD_STEPS.created, at: inv.createdAt, done: true },
    ...(sent ? [{ id: RECORD_STEPS.sent, at: sent, done: true }] : []),
    {
      id: RECORD_STEPS.opened,
      at: views?.firstAt ?? null,
      count: views?.count ?? 0,
      done: Boolean(views?.firstAt) || paid,
    },
    { id: RECORD_STEPS.paid, at: inv.paidAt, done: paid },
    ended
      ? {
          id: inv.canceledAt ? RECORD_STEPS.canceled : RECORD_STEPS.closed,
          at: inv.canceledAt ?? inv.closesAt,
          done: true,
        }
      : { id: RECORD_STEPS.wallet, at: inv.settledAt, done: inv.settledAt !== null },
  ];
}

/** The last step of a closed or canceled invoice is stopped. */
export function recordStepStates(steps: readonly RecordStep[]): RecordStepState[] {
  const ended = steps.some((s) => s.id === RECORD_STEPS.closed || s.id === RECORD_STEPS.canceled);
  const current = steps.findIndex((s) => !s.done);
  return steps.map((step, i) =>
    ended && i === steps.length - 1
      ? RECORD_STEP_STATES.stopped
      : step.done
        ? RECORD_STEP_STATES.done
        : i === current && !ended
          ? RECORD_STEP_STATES.current
          : RECORD_STEP_STATES.upcoming,
  );
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

/** net: the amount less both fees, what the owner receives. */
export function optionFees(o: FeeTerms): OptionFees {
  const network = BigInt(o.networkFee);
  const platform = BigInt(o.platformFee);
  return {
    network,
    platform,
    total: network + platform,
    net: BigInt(o.amount) - network - platform,
    clientPays: o.feesPaidBy === FEES_PAID_BY.client,
  };
}

/** The shown option's total and fees when the lines are in its units; else the main amount, no fees. */
export function linesFigures(
  main: FeeTerms & { decimals: number },
  shown: (FeeTerms & { decimals: number }) | undefined,
): { total: bigint; fees?: OptionFees } {
  return shown && shown.decimals === main.decimals
    ? { total: BigInt(shown.amount), fees: optionFees(shown) }
    : { total: BigInt(main.amount) };
}

/** Totals cover every transfer even when the API returns a bounded preview. */
export function depositAmount(
  inv: Pick<Invoice, "deposits" | "depositSummary">,
  late: boolean,
): bigint {
  return inv.depositSummary
    ? BigInt(late ? inv.depositSummary.lateAmount : inv.depositSummary.onTimeAmount)
    : inv.deposits.filter((d) => d.late === late).reduce((sum, d) => sum + BigInt(d.amount), 0n);
}

/** Paid on time above the amount, and the recorded part of it returned to the customer. */
export function overpaid(
  inv: Pick<Invoice, "amount" | "paidAt" | "deposits" | "depositSummary">,
  shown: Pick<InvoiceOption, "amounts"> | undefined,
): { extra: bigint; returned: bigint; refunded: bigint } {
  const deposited = depositAmount(inv, false);
  const amount = BigInt(inv.amount);
  const extra = inv.paidAt && deposited > amount ? deposited - amount : 0n;
  const returned = BigInt(shown?.amounts?.observedRefunded ?? "0");
  // biome-ignore lint/complexity/useMathMinMax: bigint amounts; Math.min throws on them
  return { extra, returned, refunded: returned < extra ? returned : extra };
}

/** Money after the checkout closed is late and held for the payer, whatever the status. */
export function invoiceException(inv: Invoice, status: PaymentStatus): InvoiceException {
  const sum = (late: boolean) => depositAmount(inv, late);
  const closed =
    status === PAYMENT_STATUS.canceled ||
    status === PAYMENT_STATUS.expired ||
    status === PAYMENT_STATUS.expiredPartiallyPaid;
  const received = inv.amounts
    ? BigInt(inv.amounts.payable) + (closed ? BigInt(inv.amounts.held) : 0n)
    : sum(false);
  const left =
    BigInt(inv.amount) - (closed ? 0n : inv.amounts ? BigInt(inv.amounts.payable) : received);
  return {
    kind: EXCEPTIONS[status] ?? null,
    received,
    left: left > 0n ? left : 0n,
    late: inv.amounts
      ? sum(true) < BigInt(inv.amounts.held)
        ? sum(true)
        : BigInt(inv.amounts.held)
      : sum(true),
  };
}

/** The API gives quantities with 2 decimals, so trailing zeros are only fraction digits. */
export function shortQuantity(quantity: string): string {
  return quantity.replace(/\.?0+$/, "");
}

/** New invoice filled from this one, or with only what is left of a closed one. */
export function invoiceCopyHref(invoiceId: string, rest: boolean): string {
  return `${APP_ROUTES.newInvoice}?${RESTART_PARAMS.from}=${invoiceId}${rest ? `&${RESTART_PARAMS.rest}=1` : ""}`;
}

/** New invoice filled from this one, which it replaces once created. */
export function invoiceReviseHref(invoiceId: string): string {
  return `${APP_ROUTES.newInvoice}?${RESTART_PARAMS.from}=${invoiceId}&${RESTART_PARAMS.revise}=1`;
}

// A new invoice, never the old one topped up; the rest is asked in the token paid with on time.
export function restartFrom(
  inv: Invoice,
  client: InvoiceClient | undefined,
  rest: boolean,
  reminders: InvoiceReminders | undefined,
): InvoiceStart {
  const decimals = inv.options.find((o) => o.optionId === inv.optionId)?.decimals ?? 0;
  const { received, left } = invoiceException(inv, PAYMENT_STATUS.expiredPartiallyPaid);
  // Without the fees the client paid on top: the new invoice adds its own.
  const fees = optionFees(inv);
  const onTop = fees.clientPays ? fees.total : 0n;
  const units = rest ? (left > onTop ? left - onTop : 0n) : BigInt(inv.amount) - onTop;
  // Lines are in the base units of the invoice's own option.
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
    feesPaidBy: inv.feesPaidBy,
    returnUrl: inv.returnUrl ?? "",
    reference: inv.reference ?? "",
    // It priced the whole amount, not the rest.
    agreed:
      rest || !inv.agreedValue
        ? null
        : {
            currency: inv.agreedValue.currency,
            amount: decimalText(BigInt(inv.agreedValue.amount), inv.agreedValue.decimals),
            date: inv.agreedValue.date,
          },
    // Reminders the client stopped stay off; the rest of a closed invoice starts without them.
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

/** At 1 USD per stablecoin, in cents cut once, never rounded up. */
export function owedCents(
  items: readonly (Pick<Owed, "amount" | "decimals"> & { kind?: string })[],
): bigint {
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
