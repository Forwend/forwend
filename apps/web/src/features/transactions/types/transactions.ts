import type {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
} from "@/features/transactions/constants/transactions";

export type TransactionDirection =
  (typeof TRANSACTION_DIRECTIONS)[keyof typeof TRANSACTION_DIRECTIONS];

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
