import type { HistoryRange } from "@/features/balances/types/balance-history";

/** The chart ranges, in days of history (the API takes 1 to 365). */
export const HISTORY_RANGES = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
} as const;

export const DEFAULT_RANGE: HistoryRange = "1M";

export const RANGE_OPTIONS = (Object.keys(HISTORY_RANGES) as HistoryRange[]).map((value) => ({
  value,
  label: value,
}));

export const HISTORY_FIELDS = {
  balances: "balances",
  received: "received",
  sent: "sent",
} as const;
