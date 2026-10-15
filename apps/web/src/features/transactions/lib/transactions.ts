import { formatTokenAmount, PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import {
  RELATIVE_DAYS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";
import type { RelativeDay, Transaction } from "@/features/transactions/types/transactions";
import { chainName } from "@/shared/lib/chains";

/** A transfer is "Confirming" until its block is final; unknown values never claim it is final. */
export function transactionStatus(t: Transaction): PaymentStatus {
  return t.status === TRANSACTION_STATUSES.confirmed
    ? PAYMENT_STATUS.confirmed
    : PAYMENT_STATUS.confirming;
}

export interface DayGroup<T> {
  /** The local calendar day, YYYY-MM-DD. */
  day: string;
  /** "today", "yesterday", or the day itself, for the caller to word. */
  when: RelativeDay | Date;
  items: T[];
}

const localDay = (time: Date) =>
  `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")}`;

/** Items in their order, cut into runs of the same local day, each with how to name that day from `now`. */
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

const CSV_HEADER = [
  "Date (UTC)",
  "Direction",
  "Amount",
  "Token",
  "Network",
  "Counterparty",
  "Transaction",
  "Status",
];

// Every cell is quoted; a cell a spreadsheet would run as a formula (=, +, -, @, tab, carriage return) gets a leading
// apostrophe.
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The rows as CSV with exact amounts: every decimal of the token, never rounded. */
export function transactionsCsv(items: readonly Transaction[]): string {
  const rows = items.map((t) => [
    t.at,
    t.direction,
    // No thousands separators, so spreadsheets read it as a number.
    formatTokenAmount({
      baseUnits: BigInt(t.amount),
      decimals: t.decimals,
      fractionDigits: t.decimals,
    }).replaceAll(",", ""),
    t.symbol,
    chainName(t.chainId),
    t.counterparty,
    t.txHash,
    t.status,
  ]);
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
