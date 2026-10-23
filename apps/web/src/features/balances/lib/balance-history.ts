import { HISTORY_FIELDS } from "@/features/balances/constants/balance-history";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import type {
  BalanceHistory,
  HistoryField,
  HistorySeries,
} from "@/features/balances/types/balance-history";

const USD_FIELDS = {
  [HISTORY_FIELDS.balances]: "estimatedUsd",
  [HISTORY_FIELDS.received]: "receivedUsd",
  [HISTORY_FIELDS.sent]: "sentUsd",
} as const;

function cents(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(USD_DECIMALS, "0").slice(0, USD_DECIMALS));
}

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

export function runningTotal(series: HistorySeries): HistorySeries {
  let sum = 0n;
  return { dates: series.dates, values: series.values.map((v) => (sum += v)) };
}
