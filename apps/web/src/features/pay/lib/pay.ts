import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import { tokenKey } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { PAY_STATES, PAY_TOKENS } from "@/features/pay/constants/pay";
import type { PayState } from "@/features/pay/types/pay";

/**
 * The invoice with the terms of the option the link asks for (`?option=`), while no option has money yet; otherwise
 * as the API shows it: the chosen option, or the first (R-56).
 */
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

// A transfer started at the last moment lands after expiry and is held for the payer, not paid out; the
// browser clock may also run behind.
const CLOSE_EARLY_MS = 5 * 60_000;

/** When the checkout stops showing the address: before the invoice's expiry, which still books what arrives. */
export function checkoutClosesAt(inv: Pick<Invoice, "expiresAt">): number {
  return Date.parse(inv.expiresAt) - CLOSE_EARLY_MS;
}

/**
 * Where the payment stands for the payer. Received counts deposits made before expiry, confirmed or not; late ones are
 * held for the payer. Paid and settled come only from the API (D-29). The payer may send while the checkout is open and
 * less than the amount has arrived.
 */
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

/** The payments the receipt names: confirmed and before expiry. A late one is held for the payer, not part of it. */
export function receiptDeposits(inv: Invoice) {
  // What paid the creator (R-121): late money and money over the amount are held for the payer.
  return inv.deposits.filter((d) => d.paid !== null && BigInt(d.paid) > 0n);
}

const UNITS = [
  ["day", 86_400],
  ["hour", 3_600],
  ["min", 60],
  ["s", 1],
] as const;
const PLURAL: ReadonlySet<string> = new Set(["day", "hour"]);

/** The two largest units of a duration: "6 days 23 hours", "4 min 10 s". */
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
