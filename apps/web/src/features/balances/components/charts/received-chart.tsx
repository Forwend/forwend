"use client";

import { useMemo } from "react";
import { BalanceChart } from "@/features/balances/components/charts/balance-chart";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { runningTotal } from "@/features/balances/lib/balance-history";
import type { HistorySeries } from "@/features/balances/types/balance-history";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { formatUsd } from "@/shared/lib/money";

export interface ReceivedChartProps {
  series: HistorySeries;
  label: string;
  className?: string;
}

export function ReceivedChart({ series, label, className }: ReceivedChartProps) {
  const total = useMemo(() => runningTotal(series), [series]);
  return (
    <BalanceChart
      series={total}
      label={label}
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
