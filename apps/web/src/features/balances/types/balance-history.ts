import type { z } from "zod";
import type {
  GROUPINGS,
  HISTORY_FIELDS,
  HISTORY_RANGES,
} from "@/features/balances/constants/balance-history";
import type {
  balanceHistoryPointSchema,
  balanceHistorySchema,
  tokenHistorySchema,
} from "@/features/balances/schemas/balances";

export type BalanceHistoryPoint = z.infer<typeof balanceHistoryPointSchema>;

export type TokenHistory = z.infer<typeof tokenHistorySchema>;

export type BalanceHistory = z.infer<typeof balanceHistorySchema>;

export type HistoryRange = keyof typeof HISTORY_RANGES;

export type HistoryField = (typeof HISTORY_FIELDS)[keyof typeof HISTORY_FIELDS];

export interface HistorySeries {
  dates: Date[];
  values: bigint[];
}

export type Grouping = (typeof GROUPINGS)[keyof typeof GROUPINGS];
