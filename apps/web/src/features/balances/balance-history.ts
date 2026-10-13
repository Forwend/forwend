import { USD_DECIMALS } from "@/features/balances/balances";

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

/** The chart ranges, in days of history (the API takes 1 to 365). */
export const HISTORY_RANGES = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
} as const;

export type HistoryRange = keyof typeof HISTORY_RANGES;

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

export type HistoryField = (typeof HISTORY_FIELDS)[keyof typeof HISTORY_FIELDS];

const USD_FIELDS = {
  [HISTORY_FIELDS.balances]: "estimatedUsd",
  [HISTORY_FIELDS.received]: "receivedUsd",
  [HISTORY_FIELDS.sent]: "sentUsd",
} as const;

export interface HistorySeries {
  dates: Date[];
  values: bigint[];
}

// "12.50" → 1250n; the API sends USD with 2 decimals.
function cents(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(USD_DECIMALS, "0").slice(0, USD_DECIMALS));
}

/** Null when nothing can be drawn: no points, or a missing balance. */
export function historySeries(history: BalanceHistory, field: HistoryField): HistorySeries | null {
  const usd = history.points.map((p) => p[USD_FIELDS[field]]);
  if (usd.length === 0 || usd.some((v) => v === null)) return null;
  return {
    dates: history.points.map((p) => new Date(p.at)),
    values: usd.map((v) => cents(v ?? "0")),
  };
}

export function seriesTotal(series: HistorySeries): bigint {
  return series.values.reduce((sum, v) => sum + v, 0n);
}

export function seriesChange(series: HistorySeries): bigint {
  return (series.values.at(-1) ?? 0n) - (series.values[0] ?? 0n);
}

export const GROUPINGS = {
  week: "week",
  month: "month",
} as const;

export type Grouping = (typeof GROUPINGS)[keyof typeof GROUPINGS];

/**
 * Daily amounts added up per week (from Monday) or month, in UTC; each date is the group's first day. A point belongs
 * to the day it closes (00:00 of the next day), the last one, now, to today.
 */
export function groupSeries(series: HistorySeries, by: Grouping): HistorySeries {
  const dates: Date[] = [];
  const values: bigint[] = [];
  series.dates.forEach((date, i) => {
    const day = new Date(date.getTime() - 1);
    const start =
      by === GROUPINGS.month
        ? Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)
        : Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate() - ((day.getUTCDay() + 6) % 7),
          );
    const value = series.values[i] ?? 0n;
    const last = dates.length - 1;
    if (dates[last]?.getTime() === start) values[last] = (values[last] ?? 0n) + value;
    else {
      dates.push(new Date(start));
      values.push(value);
    }
  });
  return { dates, values };
}
