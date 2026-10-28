import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import { RECONCILIATION_STATES } from "@/features/invoices/constants/invoices";
import { depositAmount, tokenKey } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { PAY_STATES, PAY_TOKENS } from "@/features/pay/constants/pay";
import type { PayState } from "@/features/pay/types/pay";

/** The `?option=` terms while no option has money; else the API's: the chosen option, or the first (R-56). */
export function withOption(inv: Invoice, optionId: string | undefined): Invoice {
  const o = inv.optionLocked
    ? undefined
    : (firstPaymentOption(inv) ?? inv.options.find((x) => x.optionId === optionId?.toLowerCase()));
  return o
    ? {
        ...inv,
        deposits: o.deposits,
        depositSummary: o.depositSummary,
        amounts: o.amounts,
        closesAt: o.closesAt ?? inv.closesAt,
        optionId: o.optionId,
        chainId: o.chainId,
        token: o.token,
        amount: o.amount,
        receiveAddress: o.receiveAddress,
      }
    : inv;
}

export function payToken(inv: Invoice) {
  return PAY_TOKENS[tokenKey(inv)] ?? null;
}

/** Public amounts use the token registry bundled with the page, never API-supplied decimal metadata. */
export function payerNoticeOptions(options: Invoice["options"]): Invoice["options"] {
  return options.flatMap((option) => {
    const token = PAY_TOKENS[tokenKey(option)];
    return token ? [{ ...option, symbol: token.symbol, decimals: token.decimals }] : [];
  });
}

// A last-moment transfer lands after the close and is held, not paid out; the browser clock may run behind.
const CLOSE_EARLY_MS = 5 * 60_000;

export function checkoutClosesAt(inv: Pick<Invoice, "closesAt">): number {
  return Date.parse(inv.closesAt) - CLOSE_EARLY_MS;
}

/** Paid and settled come only from the API (D-29); deposits after the close are held for the payer. */
export function payState(inv: Invoice, now: number) {
  const amount = BigInt(inv.amount);
  const sum = (late: boolean) => depositAmount(inv, late);
  const canceled = inv.paymentStatus === API_PAYMENT_STATUSES.canceled;
  const closed =
    canceled ||
    inv.closed ||
    now >= checkoutClosesAt(inv) ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expired ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid;
  const pending = inv.depositSummary
    ? BigInt(inv.depositSummary.pendingAmount)
    : inv.deposits
        .filter((d) => !d.late && d.paid === null)
        .reduce((n, d) => n + BigInt(d.amount), 0n);
  const received = inv.amounts
    ? closed
      ? BigInt(inv.amounts.payable) + BigInt(inv.amounts.held)
      : BigInt(inv.amounts.payable) + pending
    : sum(false);
  const rawLate = sum(true);
  const netHeld = inv.amounts ? BigInt(inv.amounts.held) : rawLate;
  let late = rawLate;
  if (netHeld < late) late = netHeld;
  if (inv.amounts?.unreconciled) late = 0n;
  const confirming = inv.deposits.some(
    (d) => !d.late && d.status !== API_DEPOSIT_STATUSES.confirmed,
  );
  const closing = closed && inv.amounts !== undefined && BigInt(inv.amounts.payable) > 0n;
  const awaitingChoice =
    inv.optionCount > 1 && !inv.optionLocked && Boolean(firstPaymentOption(inv));
  const review = Boolean(
    inv.amounts?.hasPolicyException ||
      (inv.amounts?.unreconciled &&
        inv.amounts.reconciliationStatus !== RECONCILIATION_STATES.pending),
  );
  const checking =
    inv.amounts?.reconciliationStatus === RECONCILIATION_STATES.pending && inv.deposits.length > 0;
  const state: PayState =
    inv.paymentStatus === API_PAYMENT_STATUSES.paid &&
    inv.settlementStatus === API_SETTLEMENT_STATUSES.settled
      ? PAY_STATES.settled
      : inv.paymentStatus === API_PAYMENT_STATUSES.paid
        ? PAY_STATES.paid
        : review
          ? PAY_STATES.review
          : canceled
            ? PAY_STATES.canceled
            : checking
              ? PAY_STATES.checking
              : awaitingChoice
                ? PAY_STATES.checking
                : confirming
                  ? PAY_STATES.confirming
                  : closing
                    ? PAY_STATES.closing
                    : received >= amount
                      ? PAY_STATES.checking
                      : received > 0n
                        ? closed
                          ? PAY_STATES.closedPartial
                          : PAY_STATES.partial
                        : closed
                          ? PAY_STATES.closed
                          : PAY_STATES.waiting;
  return {
    state,
    delayed:
      state === PAY_STATES.checking &&
      inv.deposits.some(
        (deposit) =>
          deposit.status === API_DEPOSIT_STATUSES.confirmed &&
          deposit.paid === null &&
          now - Date.parse(deposit.blockTime) > 5 * 60_000,
      ),
    closed,
    canSend:
      !closed &&
      !awaitingChoice &&
      !review &&
      !checking &&
      received < amount &&
      state !== PAY_STATES.paid &&
      state !== PAY_STATES.settled,
    received,
    remaining: received < amount ? amount - received : 0n,
    late,
  };
}

/** Only payments that paid the creator (R-121); late money and money over the amount are held. */
export function receiptDeposits(inv: Invoice) {
  return inv.deposits.filter((d) => d.paid !== null && BigInt(d.paid) > 0n);
}

const UNITS = [
  ["day", 86_400],
  ["hour", 3_600],
  ["min", 60],
  ["s", 1],
] as const;
const PLURAL: ReadonlySet<string> = new Set(["day", "hour"]);

export function shortDuration(ms: number): string {
  let left = Math.max(0, Math.floor(ms / 1000));
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    if (parts.length === 2) break;
    const n = Math.floor(left / size);
    left -= n * size;
    if (n > 0 || parts.length > 0)
      parts.push(`${n} ${unit}${n !== 1 && PLURAL.has(unit) ? "s" : ""}`);
  }
  return parts.join(" ") || "0 s";
}

export function firstPaymentOption(inv: Invoice): Invoice["options"][number] | undefined {
  return inv.options
    .flatMap((option) =>
      option.deposits.filter((deposit) => !deposit.late).map((deposit) => ({ option, deposit })),
    )
    .sort(
      (a, b) =>
        Date.parse(a.deposit.blockTime) - Date.parse(b.deposit.blockTime) ||
        a.option.chainId - b.option.chainId ||
        a.deposit.blockNumber - b.deposit.blockNumber ||
        a.deposit.logIndex - b.deposit.logIndex,
    )[0]?.option;
}
