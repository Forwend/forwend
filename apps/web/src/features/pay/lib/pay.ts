import { RECONCILIATION_STATES } from "@/features/invoices/constants/invoices";
import { depositAmount, tokenKey } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { PAY_STATES, PAY_TOKENS } from "@/features/pay/constants/pay";
import type { PayState } from "@/features/pay/types/pay";
import {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/shared/constants/payment-state";

/** The picked option's terms while no option has money; else the API's: the chosen option, or the first (R-56). */
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
        networkFee: o.networkFee,
        platformFee: o.platformFee,
        feesPaidBy: o.feesPaidBy,
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

/** Money sent on time over the amount and still held for the payer. Once booked it is capped at the ledger's held
 * money, so a return leaves nothing; late money has its own line and takes held money first, as in payState. */
export function overpaid(inv: Invoice): bigint {
  const extra = depositAmount(inv, false) - BigInt(inv.amount);
  if (extra <= 0n) return 0n;
  if (!inv.amounts || inv.amounts.unreconciled) return extra;
  const held = BigInt(inv.amounts.held);
  let late = depositAmount(inv, true);
  if (late > held) late = held;
  const rest = held - late;
  if (extra > rest) return rest;
  return extra;
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

/** Whether the page still changes with the clock: not once the payment is final or the API says its checkout closed,
 * except while money is being checked, whose delay note counts from the deposit's block time. */
export function clockRuns(inv: Invoice): boolean {
  const { state, closed } = payState(inv, 0);
  return (
    state === PAY_STATES.checking ||
    (!closed && state !== PAY_STATES.paid && state !== PAY_STATES.settled)
  );
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

/** The option a payer-chooses invoice takes (R-56, R-119): the first whose on-time deposits add up to 1.00 USD, one
 * whole stablecoin (D-75), or an older invoice's whole amount when that is smaller. A smaller deposit chooses nothing. */
export function firstPaymentOption(inv: Invoice): Invoice["options"][number] | undefined {
  type Crossing = { option: Invoice["options"][number]; deposit: Invoice["deposits"][number] };
  const earlier = (a: Crossing, b: Crossing) =>
    Date.parse(a.deposit.blockTime) - Date.parse(b.deposit.blockTime) ||
    a.option.chainId - b.option.chainId ||
    a.deposit.blockNumber - b.deposit.blockNumber ||
    a.deposit.logIndex - b.deposit.logIndex;
  let first: Crossing | undefined;
  for (const option of inv.options) {
    const whole = 10n ** BigInt(option.decimals);
    const least = BigInt(option.amount) < whole ? BigInt(option.amount) : whole;
    let total = 0n;
    for (const deposit of option.deposits
      .filter((d) => !d.late)
      .sort((a, b) => earlier({ option, deposit: a }, { option, deposit: b }))) {
      total += BigInt(deposit.amount);
      if (total >= least) {
        if (!first || earlier({ option, deposit }, first) < 0) first = { option, deposit };
        break;
      }
    }
  }
  return first?.option;
}
