"use client";

import { Button, SegmentedControl, Skeleton } from "@forwend/ui-web";
import { TrendingDown, TrendingUp } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useGetBalanceHistoryQuery } from "@/features/balances/api/balances-api";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import { BalanceChart } from "@/features/balances/components/charts/balance-chart";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { MoneyActions } from "@/features/balances/components/money-actions";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
  RANGE_OPTIONS,
} from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { historySeries, seriesChange } from "@/features/balances/lib/balance-history";
import { formatUsd } from "@/features/balances/lib/balances";
import type { HistoryRange, HistorySeries } from "@/features/balances/types/balance-history";
import type { Balances } from "@/features/balances/types/balances";
import { BALANCE_LIGHT_IMAGE, BALANCE_NIGHT_IMAGE } from "@/shared/assets/images";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface BalanceHeroProps {
  profileId: string;
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
  onReceive: () => void;
  onRequest: () => void;
}

export function BalanceHero({
  profileId,
  balances,
  failed,
  onRetry,
  onReceive,
  onRequest,
}: BalanceHeroProps) {
  const [range, setRange] = useState<HistoryRange>(DEFAULT_RANGE);
  const history = useGetBalanceHistoryQuery({ profileId, days: HISTORY_RANGES[range] }, LIVE_QUERY);
  // The chart keeps the last range's line, dimmed, while the next loads; figures for the range wait for their own data.
  const series = history.data ? historySeries(history.data, HISTORY_FIELDS.balances) : null;
  const current = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.balances)
    : null;
  const rangeName = BALANCES_COPY.rangeNames[range];
  const chartLabel = BALANCES_COPY.balanceOver(rangeName);

  const chart = (compact: boolean) =>
    history.isError && !history.currentData ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
        {BALANCES_COPY.historyFailed}
        <Button size="sm" variant="secondary" onClick={history.refetch}>
          {BALANCES_COPY.retry}
        </Button>
      </div>
    ) : !history.data ? (
      <Skeleton className="h-full w-full" />
    ) : !series ? (
      <p className="text-sm text-muted">{BALANCES_COPY.historyUnavailable}</p>
    ) : (
      <BalanceChart
        series={series}
        label={chartLabel}
        compact={compact}
        className={`h-full transition-opacity duration-[var(--fw-duration-base)] ${history.isFetching && !history.currentData ? "opacity-60" : ""}`}
      />
    );
  const rangeControl = (
    <SegmentedControl
      label={BALANCES_COPY.chartRange}
      options={RANGE_OPTIONS}
      value={range}
      onValueChange={setRange}
    />
  );

  return (
    <>
      <section
        aria-labelledby="balance-title"
        className="relative isolate -mx-4 -mt-4 flex flex-col overflow-hidden sm:min-h-96 bg-surface sm:mx-0 sm:mt-0 sm:rounded-md sm:border sm:border-line [&_svg_text]:stroke-none dark:[&_svg_text]:stroke-surface"
      >
        <Image
          src={BALANCE_LIGHT_IMAGE.src}
          alt=""
          fill
          priority
          sizes="(min-width: 64rem) 80vw, 100vw"
          className="-z-10 object-cover object-bottom dark:hidden"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_45%,color-mix(in_oklab,var(--fw-surface)_70%,transparent)_100%)] dark:hidden" />
        <Image
          src={BALANCE_NIGHT_IMAGE.src}
          alt=""
          fill
          loading="eager"
          sizes="(min-width: 64rem) 80vw, 100vw"
          className="-z-10 hidden object-cover object-bottom dark:block"
        />
        <div className="absolute inset-0 -z-10 hidden bg-[linear-gradient(180deg,color-mix(in_oklab,var(--fw-surface)_45%,transparent)_0%,transparent_40%,color-mix(in_oklab,var(--fw-bg)_80%,transparent)_72%,var(--fw-bg)_100%)] lg:bg-[linear-gradient(90deg,color-mix(in_oklab,var(--fw-surface)_78%,transparent)_0%,color-mix(in_oklab,var(--fw-surface)_40%,transparent)_38%,transparent_70%)] dark:block" />

        <div className="grid flex-1 gap-8 px-4 pt-8 pb-10 sm:px-6 sm:py-8 lg:gap-10 lg:p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex flex-col items-center justify-between gap-8 sm:gap-10 lg:items-start lg:gap-6">
            <div className="flex w-full flex-col items-center gap-3 lg:items-start">
              <div className="flex items-center gap-1">
                <h2 id="balance-title" className="text-sm font-medium text-muted">
                  {BALANCES_COPY.totalBalanceIn(MONEY_COPY.usd)}
                </h2>
                <EstimateHint />
              </div>
              <div
                aria-busy={!balances && !failed}
                className="@container flex w-full flex-col items-center gap-2 lg:items-start"
              >
                <BalanceFigure balances={balances} failed={failed} onRetry={onRetry} />
                {current ? (
                  <Change series={current} rangeName={rangeName} />
                ) : history.currentData || history.isError ? null : (
                  <Skeleton className="h-5 w-40" />
                )}
              </div>
            </div>
            <MoneyActions onReceive={onReceive} onRequest={onRequest} />
          </div>
          <div className="hidden min-h-0 min-w-0 flex-col gap-3 lg:flex">
            <div className="flex justify-end">{rangeControl}</div>
            <div className="min-h-0 flex-1">{chart(false)}</div>
          </div>
        </div>
      </section>

      <section aria-label={chartLabel} className="fw-panel flex flex-col gap-3 p-4 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">{BALANCES_COPY.balanceTitle}</h2>
          {rangeControl}
        </div>
        <div className="aspect-[5/2]">{chart(true)}</div>
      </section>
    </>
  );
}

// How the balance moved over the range, with direction in words and an icon, not color alone.
function Change({ series, rangeName }: { series: HistorySeries; rangeName: string }) {
  const change = seriesChange(series);
  const amount = formatUsd(change < 0n ? -change : change);
  if (change === 0n) {
    return (
      <p className="text-sm text-muted">
        {BALANCES_COPY.noChange} · {rangeName}
      </p>
    );
  }
  const up = change > 0n;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <span
        className={`inline-flex items-center gap-1 font-medium ${up ? "text-success" : "text-danger"}`}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
        <span className="tabular-nums">
          {up ? "+" : "−"}
          {amount} {MONEY_COPY.usd}
        </span>
      </span>
      <span className="text-muted">{rangeName}</span>
    </p>
  );
}
