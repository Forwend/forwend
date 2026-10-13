import type {
  GROUPINGS,
  HISTORY_FIELDS,
  HISTORY_RANGES,
} from "@/features/balances/constants/balance-history";

/** GET /v1/profiles/{id}/balance-history, BalanceHistoryPoint: the end of one UTC day; the last point is now. */
export interface BalanceHistoryPoint {
  at: string;
  estimatedUsd: string | null;
  receivedUsd: string | null;
  sentUsd: string | null;
}

export interface TokenHistory {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  balances: string[] | null;
  received: string[] | null;
  sent: string[] | null;
}

export interface BalanceHistory {
  points: BalanceHistoryPoint[];
  tokens: TokenHistory[];
}

export type HistoryRange = keyof typeof HISTORY_RANGES;

export type HistoryField = (typeof HISTORY_FIELDS)[keyof typeof HISTORY_FIELDS];

export interface HistorySeries {
  dates: Date[];
  values: bigint[];
}

export type Grouping = (typeof GROUPINGS)[keyof typeof GROUPINGS];
