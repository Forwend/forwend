import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/activity";
import { type Invoice, type InvoiceToken, tokenKey } from "@/features/invoices/invoices";

/** openapi.yaml, InvoiceId: the on-chain invoice id. */
export const INVOICE_ID_PATTERN = /^0x[0-9a-f]{64}$/;

export type PayToken = Pick<InvoiceToken, "symbol" | "decimals">;

/**
 * Tokens the pay page names, by chain and contract (docs/spikes/s5-s6-testnets.md). The symbol and decimals come from
 * this build, never from the API, and the page refuses any other token. Add a token here when the API enables it.
 */
export const PAY_TOKENS: Readonly<Record<string, PayToken>> = {
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 },
  "421614:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": { symbol: "USDC", decimals: 6 },
  "5042002:0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6 },
  "42431:0x20c0000000000000000000006a37da5c996874be": { symbol: "OUSD", decimals: 6 },
};

/** How the payer sends: the instructions differ, the address and amount do not. */
export const PAY_METHODS = { wallet: "wallet", exchange: "exchange" } as const;
export type PayMethod = (typeof PAY_METHODS)[keyof typeof PAY_METHODS];

/** What the status panel says, in the order the checks run. */
export const PAY_STATES = {
  settled: "settled",
  paid: "paid",
  confirming: "confirming",
  checking: "checking",
  partial: "partial",
  closedPartial: "closedPartial",
  closed: "closed",
  waiting: "waiting",
} as const;

export type PayState = (typeof PAY_STATES)[keyof typeof PAY_STATES];

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

// A transfer started at the last moment lands after expiry and is held for the payer, not paid to the sender; the
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
  const closed =
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
    extra: received > amount ? received - amount : 0n,
    late,
  };
}

/** The payments the receipt names: confirmed and before expiry. A late one is held for the payer, not part of it. */
export function receiptDeposits(inv: Invoice) {
  return inv.deposits.filter((d) => !d.late && d.status === API_DEPOSIT_STATUSES.confirmed);
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
