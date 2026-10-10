import { formatTokenAmount, PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import { chainName } from "@/shared/chains/chains";

export const TRANSACTION_DIRECTIONS = {
  in: "in",
  out: "out",
} as const;

export const TRANSACTION_STATUSES = {
  detected: "detected",
  confirmed: "confirmed",
} as const;

export const TRANSACTION_FILTERS = {
  all: "all",
  ...TRANSACTION_DIRECTIONS,
} as const;

export const TRANSACTIONS_PAGE_SIZE = 20;
export const TRANSACTIONS_MAX = 100;

export type TransactionDirection =
  (typeof TRANSACTION_DIRECTIONS)[keyof typeof TRANSACTION_DIRECTIONS];

export type TransactionFilter = (typeof TRANSACTION_FILTERS)[keyof typeof TRANSACTION_FILTERS];

export interface Transaction {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  direction: TransactionDirection;
  /** Base units. */
  amount: string;
  /** The sender for in, the receiver for out; the zero address for a mint or a burn. */
  counterparty: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  at: string;
  /** Other values may come from a newer API. */
  status: (typeof TRANSACTION_STATUSES)[keyof typeof TRANSACTION_STATUSES] | (string & {});
}

export interface TransactionsPage {
  items: Transaction[];
  nextCursor: string | null;
}

/** A transfer is "Confirming" until its block is final; unknown values never claim it is final. */
export function transactionStatus(t: Transaction): PaymentStatus {
  return t.status === TRANSACTION_STATUSES.confirmed
    ? PAYMENT_STATUS.confirmed
    : PAYMENT_STATUS.confirming;
}

/** One key per transfer: a transaction can move tokens several times, once per log. */
export function transactionKey(t: Transaction): string {
  return `${t.chainId}:${t.txHash}:${t.logIndex}`;
}

/** Rows in one direction whose counterparty, hash or token contains the search, in any letter case. */
export function filterTransactions(
  items: readonly Transaction[],
  filter: TransactionFilter,
  search: string,
): Transaction[] {
  const query = search.trim().toLowerCase();
  return items.filter(
    (t) =>
      (filter === TRANSACTION_FILTERS.all || t.direction === filter) &&
      (!query ||
        t.counterparty.toLowerCase().includes(query) ||
        t.txHash.toLowerCase().includes(query) ||
        t.symbol.toLowerCase().includes(query)),
  );
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
