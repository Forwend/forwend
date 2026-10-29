import type { ReactNode } from "react";
import { BalanceChart } from "@/features/balances/components/charts/balance-chart";
import { flatSeries } from "@/features/balances/lib/balance-history";

export interface EmptyChartProps {
  days: number;
  compact?: boolean;
  /** Centered over the frame: an error with Try again, or a short note. */
  children: ReactNode;
}

/** A chart with nothing to draw keeps its frame and dates, faded, so the card holds its shape and reads as a chart. */
export function EmptyChart({ days, compact, children }: EmptyChartProps) {
  return (
    <div className="relative h-full">
      <div inert aria-hidden className="h-full opacity-40">
        <BalanceChart series={flatSeries(days)} label="" compact={compact} className="h-full" />
      </div>
      <div className="absolute inset-0 flex">{children}</div>
    </div>
  );
}
