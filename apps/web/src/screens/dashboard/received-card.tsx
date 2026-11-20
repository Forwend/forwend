"use client";

import { Card, SegmentedControl, Skeleton } from "@forwend/ui-web";
import { EmptyChart } from "@/features/balances/components/charts/empty-chart";
import { ReceivedChart } from "@/features/balances/components/charts/received-chart";
import { RANGE_OPTIONS } from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { seriesTotal } from "@/features/balances/lib/balance-history";
import type { HistoryRange, HistorySeries } from "@/features/balances/types/balance-history";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { LoadError } from "@/shared/components/load-error";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { formatUsd } from "@/shared/lib/money";

export interface ReceivedCardProps {
  range: HistoryRange;
  days: number;
  onRange: (range: HistoryRange) => void;
  rangeName: string;
  received: HistorySeries | null; // the last range's, kept while the next loads
  receivedNow: HistorySeries | null;
  sentNow: HistorySeries | null;
  transfers: string | null; // "100+" when the read stops short of the range
  loading: boolean;
  fetching: boolean;
  failed: boolean;
  onRetry: () => void;
}

/** Money in over the range at market prices, drawn as a running total. */
export function ReceivedCard({
  range,
  days,
  onRange,
  rangeName,
  received,
  receivedNow,
  sentNow,
  transfers,
  loading,
  fetching,
  failed,
  onRetry,
}: ReceivedCardProps) {
  return (
    <Card
      id="received-title"
      title={COPY.receivedTitle}
      description={transfers === null ? rangeName : `${COPY.transfersIn(transfers)} · ${rangeName}`}
      action={
        <SegmentedControl
          label={BALANCES_COPY.chartRange}
          options={RANGE_OPTIONS}
          value={range}
          onValueChange={onRange}
          size="sm"
        />
      }
      actionBelow
      className="flex flex-col"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {receivedNow ? (
          <p className="text-3xl font-medium tracking-tight text-ink tabular-nums">
            {formatUsd(seriesTotal(receivedNow))}{" "}
            <span className="text-sm font-normal tracking-normal text-subtle">
              {MONEY_COPY.usd}
            </span>
          </p>
        ) : failed || (!loading && !received) ? (
          <p className="text-3xl font-medium text-muted">—</p>
        ) : (
          <Skeleton className="h-[1.15em] w-40 text-3xl" />
        )}
        {sentNow ? (
          <p className="text-sm text-muted tabular-nums">
            {COPY.sent(formatUsd(seriesTotal(sentNow)))}
          </p>
        ) : loading ? (
          <Skeleton className="h-5 w-28" />
        ) : null}
      </div>
      <div className="mt-3 grid min-h-48 flex-1 grid-rows-[minmax(0,1fr)] sm:min-h-56">
        {failed && !received ? (
          <EmptyChart days={days}>
            <LoadError message={BALANCES_COPY.historyFailed} onRetry={onRetry} />
          </EmptyChart>
        ) : loading ? (
          <Skeleton className="h-full" />
        ) : !received ? (
          <EmptyChart days={days}>
            <p className="m-auto text-sm text-muted">{BALANCES_COPY.historyUnavailable}</p>
          </EmptyChart>
        ) : (
          <ReceivedChart
            series={received}
            label={BALANCES_COPY.receivedOver(rangeName)}
            className={`h-full transition-opacity duration-[var(--fw-duration-base)] ${fetching ? "opacity-60" : ""}`}
          />
        )}
      </div>
    </Card>
  );
}
