import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import { tokenKey } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { PAY_STATES, PAY_TOKENS } from "@/features/pay/constants/pay";
import type { PayState } from "@/features/pay/types/pay";

/** The `?option=` terms while no option has money; else the API's: the chosen option, or the first (R-56). */
export function withOption(inv: Invoice, optionId: string | undefined): Invoice {
  const o = inv.optionLocked
    ? undefined
    : inv.options.find((x) => x.optionId === optionId?.toLowerCase());
  return o
    ? {
        ...inv,
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

// A last-moment transfer lands after the close and is held, not paid out; the browser clock may run behind.
const CLOSE_EARLY_MS = 5 * 60_000;

export function checkoutClosesAt(inv: Pick<Invoice, "closesAt">): number {
  return Date.parse(inv.closesAt) - CLOSE_EARLY_MS;
}

/** Paid and settled come only from the API (D-29); deposits after the close are held for the payer. */
export function payState(inv: Invoice, now: number) {
  const amount = BigInt(inv.amount);
  const sum = (late: boolean) =>
    inv.deposits.filter((d) => d.late === late).reduce((s, d) => s + BigInt(d.amount), 0n);
  const received = sum(false);
  const late = sum(true);
  const canceled = inv.paymentStatus === API_PAYMENT_STATUSES.canceled;
  const closed =
    canceled ||
    now >= checkoutClosesAt(inv) ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expired ||
    inv.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid;
  const confirming = inv.deposits.some(
    (d) => !d.late && d.status !== API_DEPOSIT_STATUSES.confirmed,
  );
  const state: PayState =
    inv.settlementStatus === API_SETTLEMENT_STATUSES.settled
      ? PAY_STATES.settled
      : inv.paymentStatus === API_PAYMENT_STATUSES.paid
        ? PAY_STATES.paid
        : // Canceled takes no money, whatever arrives: it is all held for the payer (R-79, D-26).
          canceled
          ? PAY_STATES.canceled
          : confirming
            ? PAY_STATES.confirming
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
    closed,
    canSend:
      !closed && received < amount && state !== PAY_STATES.paid && state !== PAY_STATES.settled,
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
