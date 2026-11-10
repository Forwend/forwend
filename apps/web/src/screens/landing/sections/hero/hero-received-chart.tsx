"use client";

import { useEffect, useState } from "react";
import { ReceivedChart } from "@/features/balances/components/charts/received-chart";
import { DEFAULT_RANGE } from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { flatSeries } from "@/features/balances/lib/balance-history";
import type { HistorySeries } from "@/features/balances/types/balance-history";
import { DASHBOARD } from "./constants/hero-dashboard";

/**
 * The overview's own Received chart, drawn from the sample month. Its days end on the visitor's today, so it is built
 * after load: a prerendered page would carry the build's dates.
 */
export function HeroReceivedChart({ className }: { className?: string }) {
  const [series, setSeries] = useState<HistorySeries | null>(null);

  useEffect(() => {
    const { dates } = flatSeries(DASHBOARD.received.days.length);
    setSeries({ dates, values: [...DASHBOARD.received.days] });
  }, []);

  return (
    <div className={className}>
      {series ? (
        <ReceivedChart
          series={series}
          label={BALANCES_COPY.receivedOver(BALANCES_COPY.rangeNames[DEFAULT_RANGE])}
          className="h-full"
        />
      ) : null}
    </div>
  );
}
