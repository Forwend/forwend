"use client";

import { useMemo } from "react";
import { BalanceChart } from "@/features/balances/components/charts/balance-chart";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { runningTotal } from "@/features/balances/lib/balance-history";
import { formatUsd } from "@/features/balances/lib/balances";
import type { HistorySeries } from "@/features/balances/types/balance-history";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface ReceivedChartProps {
  series: HistorySeries;
  label: string;
  compact?: boolean;
  className?: string;
}

// Money in as a running total over the range: it climbs with each payment and ends on the range's whole amount, which
// says more than a row of mostly empty days. The readout adds what the chosen day brought in.
export function ReceivedChart({ series, label, compact, className }: ReceivedChartProps) {
  const total = useMemo(() => runningTotal(series), [series]);
  return (
    <BalanceChart
      series={total}
      label={label}
      compact={compact}
      className={className}
      readoutNote={(i) => {
        const day = series.values[i] ?? 0n;
        return day > 0n
          ? BALANCES_COPY.receivedThatDay(formatUsd(day), MONEY_COPY.usd)
          : BALANCES_COPY.noneThatDay;
      }}
    />
  );
}
