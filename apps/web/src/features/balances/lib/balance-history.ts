import { HISTORY_FIELDS } from "@/features/balances/constants/balance-history";
import type {
  BalanceHistory,
  HistoryField,
  HistorySeries,
} from "@/features/balances/types/balance-history";
import { totalUsdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";

/** Each point's tokens together in USD cents at the latest market price, as the total beside the chart (R-178). null
 * without prices, with a missing balance, or when an amount has no price: never a made-up value. Money in and out
 * value their running sum and give each day its difference, so a range's total is cut to cents once. */
export function historySeries(
  history: BalanceHistory,
  field: HistoryField,
  prices: readonly TokenPrice[] | undefined,
): HistorySeries | null {
  if (!prices || history.points.length === 0) return null;
  const flow = field !== HISTORY_FIELDS.balances;
  const sums = history.tokens.map(() => 0n);
  const values: bigint[] = [];
  let before = 0n;
  for (let i = 0; i < history.points.length; i++) {
    const amounts = [];
    for (const [j, t] of history.tokens.entries()) {
      const units = t[field]?.[i];
      if (units === undefined) return null;
      sums[j] = flow ? (sums[j] ?? 0n) + BigInt(units) : BigInt(units);
      amounts.push({
        chainId: t.chainId,
        token: t.token,
        decimals: t.decimals,
        baseUnits: sums[j] ?? 0n,
      });
    }
    const cents = totalUsdCents(prices, amounts);
    if (cents === null) return null;
    values.push(flow ? cents - before : cents);
    before = cents;
  }
  return { dates: history.points.map((p) => new Date(p.at)), values };
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

/** `days` UTC days of zero ending today: the chart's frame when there is no history to draw. */
export function flatSeries(days: number, now = Date.now()): HistorySeries {
  const today = new Date(now);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dates = Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000));
  return { dates, values: dates.map(() => 0n) };
}
