"use client";

import { Card, SegmentedControl, Skeleton } from "@forwend/ui-web";
import { useState } from "react";
import { BalanceChart } from "@/features/balances/components/charts/balance-chart";
import { EmptyChart } from "@/features/balances/components/charts/empty-chart";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
  RANGE_OPTIONS,
} from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { usePricedHistory } from "@/features/balances/hooks/use-priced-balances";
import { historySeries } from "@/features/balances/lib/balance-history";
import type { HistoryRange } from "@/features/balances/types/balance-history";
import { LoadError } from "@/shared/components/load-error";

export interface BalanceHistoryCardProps {
  profileId: string;
}

/** The personal balance over a chosen range. */
export function BalanceHistoryCard({ profileId }: BalanceHistoryCardProps) {
  const [range, setRange] = useState<HistoryRange>(DEFAULT_RANGE);
  const history = usePricedHistory(profileId, HISTORY_RANGES[range]);
  // The chart keeps the last range's line, dimmed, while the next loads.
  const series = history.data
    ? historySeries(history.data, HISTORY_FIELDS.balances, history.prices)
    : null;
  const label = BALANCES_COPY.balanceOver(BALANCES_COPY.rangeNames[range]);

  return (
    <Card
      id="balance-history-title"
      title={BALANCES_COPY.balanceTitle}
      action={
        <SegmentedControl
          label={BALANCES_COPY.chartRange}
          options={RANGE_OPTIONS}
          value={range}
          onValueChange={setRange}
          size="sm"
        />
      }
      className="flex flex-col"
    >
      <div className="aspect-[5/2] min-h-0 sm:aspect-auto sm:h-56 [&_svg_text]:stroke-none">
        {history.isError && !history.currentData ? (
          <EmptyChart days={HISTORY_RANGES[range]}>
            <LoadError
              message={BALANCES_COPY.historyFailed}
              onRetry={() => void history.refetch()}
            />
          </EmptyChart>
        ) : !history.data ? (
          <Skeleton className="h-full w-full" />
        ) : !series ? (
          <EmptyChart days={HISTORY_RANGES[range]}>
            <p className="m-auto text-sm text-muted">{BALANCES_COPY.historyUnavailable}</p>
          </EmptyChart>
        ) : (
          // Phones get the compact plot: first and last dates only.
          [true, false].map((compact) => (
            <BalanceChart
              key={String(compact)}
              series={series}
              label={label}
              compact={compact}
              className={`h-full transition-opacity duration-[var(--fw-duration-base)] ${compact ? "sm:hidden" : "max-sm:hidden"} ${history.isFetching && !history.currentData ? "opacity-60" : ""}`}
            />
          ))
        )}
      </div>
    </Card>
  );
}
