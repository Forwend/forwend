import { formatTokenAmount, PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import type { Send } from "@/features/send/types/send";
import {
  RELATIVE_DAYS,
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import type { RelativeDay, Transaction } from "@/features/transactions/types/transactions";
import { exactDigits } from "@/shared/lib/money";

/** A transfer is "Confirming" until its block is final; unknown values never claim it is final. */
export function transactionStatus(t: Transaction): PaymentStatus {
  return t.status === TRANSACTION_STATUSES.confirmed
    ? PAYMENT_STATUS.confirmed
    : t.status === TRANSACTION_STATUSES.sending
      ? PAYMENT_STATUS.sending
      : PAYMENT_STATUS.confirming;
}

/** R-224: the fee the wallet paid for the send behind the transfer, to the last digit; null where there is none to show,
 *  as for a transfer no send made, or one Forwend paid for. */
export function feeText(t: Transaction): string | null {
  if (!t.feePaid) return null;
  const units = BigInt(t.feePaid);
  if (units === 0n) return null;
  const amount = formatTokenAmount({
    baseUnits: units,
    decimals: t.decimals,
    fractionDigits: exactDigits(units, t.decimals),
  });
  return TRANSACTIONS_COPY.fee(`${amount} ${t.symbol}`);
}

/** A signed send no block holds yet, as a row (R-215). Its transfer's own row takes its place once recorded; it has
 * no log yet, so its key's log index is -1, and no USD value, since no row shows one. */
export function sendingRow(s: Send & { txHash: string }): Transaction {
  return {
    chainId: s.chainId,
    token: s.token,
    symbol: s.symbol,
    decimals: s.decimals,
    direction: TRANSACTION_DIRECTIONS.out,
    amount: s.amount,
    counterparty: s.to,
    txHash: s.txHash,
    logIndex: -1,
    blockNumber: 0,
    at: s.createdAt,
    status: TRANSACTION_STATUSES.sending,
    usdValue: "0",
    classification: s.toProfileId ? TRANSACTION_CLASSES.ownTransfer : TRANSACTION_CLASSES.sent,
    labelable: false,
    invoice: null,
    recordsValue: null,
    feePaid: null,
  };
}

/** The pending sends still owed a row: signed, and no recorded row carries their hash yet (R-215). */
export function sendingRows(sends: Send[], recorded: Transaction[]): Transaction[] {
  return sends
    .filter((s): s is Send & { txHash: string } => s.txHash !== null)
    .filter((s) => !recorded.some((t) => t.txHash === s.txHash))
    .map(sendingRow);
}

export interface DayGroup<T> {
  /** The local calendar day, YYYY-MM-DD. */
  day: string;
  when: RelativeDay | Date;
  items: T[];
}

const localDay = (time: Date) =>
  `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")}`;

/** Keeps the items' order: runs of the same local day, not sorted. */
export function groupByDay<T extends { at: string }>(
  items: readonly T[],
  now: Date,
): DayGroup<T>[] {
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const time = new Date(item.at);
    const day = localDay(time);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else
      groups.push({
        day,
        when:
          day === today ? RELATIVE_DAYS.today : day === yesterday ? RELATIVE_DAYS.yesterday : time,
        items: [item],
      });
  }
  return groups;
}

/** One key per transfer: a transaction can move tokens several times, once per log. */
export function transactionKey(t: Transaction): string {
  return `${t.chainId}:${t.txHash}:${t.logIndex}`;
}
