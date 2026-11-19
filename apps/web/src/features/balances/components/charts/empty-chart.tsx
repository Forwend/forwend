import type { ReactNode } from "react";
import { BalanceChart } from "@/features/balances/components/charts/balance-chart";
import { flatSeries } from "@/features/balances/lib/balance-history";

export interface EmptyChartProps {
  days: number;
  children: ReactNode;
}

export function EmptyChart({ days, children }: EmptyChartProps) {
  return (
    <div className="relative h-full">
      <div inert aria-hidden className="h-full opacity-40">
        <BalanceChart series={flatSeries(days)} label="" className="h-full" />
      </div>
      <div className="absolute inset-0 flex">{children}</div>
    </div>
  );
}
