import { GROUPINGS, HISTORY_FIELDS } from "@/features/balances/constants/balance-history";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import type {
  BalanceHistory,
  Grouping,
  HistoryField,
  HistorySeries,
} from "@/features/balances/types/balance-history";

const USD_FIELDS = {
  [HISTORY_FIELDS.balances]: "estimatedUsd",
  [HISTORY_FIELDS.received]: "receivedUsd",
  [HISTORY_FIELDS.sent]: "sentUsd",
} as const;

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
