"use client";

import { Button, SegmentedControl, Skeleton } from "@forwend/ui-web";
import { TrendingDown, TrendingUp } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useState } from "react";
import { BalanceChart } from "@/features/balances/balance-chart";
import { BalanceFigure } from "@/features/balances/balance-figure";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
  type HistoryRange,
  type HistorySeries,
  historySeries,
  RANGE_OPTIONS,
  seriesChange,
} from "@/features/balances/balance-history";
import { type Balances, formatUsd, USD } from "@/features/balances/balances";
import { useGetBalanceHistoryQuery } from "@/features/balances/balances-api";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { MoneyActions } from "@/features/balances/money-actions";
import { BALANCE_DAWN_IMAGE, BALANCE_NIGHT_IMAGE } from "@/shared/assets/images";
import { LIVE_QUERY } from "@/shared/config/refresh";

export function BalanceHero({
  profileId,
  profile,
  balances,
  failed,
  onRetry,
  onReceive,
}: {
  profileId: string;
  profile: ReactNode;
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
  onReceive: () => void;
}) {
  const [range, setRange] = useState<HistoryRange>(DEFAULT_RANGE);
  const history = useGetBalanceHistoryQuery({ profileId, days: HISTORY_RANGES[range] }, LIVE_QUERY);
  const series = history.data ? historySeries(history.data, HISTORY_FIELDS.balances) : null;
  const rangeName = BALANCES_COPY.rangeNames[range];
  const chartLabel = BALANCES_COPY.balanceOver(rangeName);

  const chart = (compact: boolean) =>
    history.isError && !history.data ? (
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
        className={`h-full transition-opacity duration-[var(--fw-duration-base)] ${history.isFetching ? "opacity-60" : ""}`}
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
        className="relative isolate -mx-4 -mt-4 flex flex-col overflow-hidden bg-surface sm:mx-0 sm:mt-0 sm:rounded-md sm:border sm:border-line lg:aspect-[4/1] lg:max-h-[26rem] lg:min-h-[19rem]"
      >
        <Image
          src={BALANCE_DAWN_IMAGE.src}
          alt=""
          fill
          priority
          sizes="(min-width: 64rem) 80vw, 100vw"
          className="-z-10 object-cover object-bottom dark:hidden"
        />
        <Image
          src={BALANCE_NIGHT_IMAGE.src}
          alt=""
          fill
          loading="eager"
          sizes="(min-width: 64rem) 80vw, 100vw"
          className="-z-10 hidden object-cover object-bottom dark:block"
        />
        {/* A soft wash of the surface behind the figures keeps text at full contrast over the sky; on phones the valley
            fades into the page under the actions, as a banking app's header does. */}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--fw-surface)_45%,transparent)_0%,transparent_40%,color-mix(in_oklab,var(--fw-bg)_80%,transparent)_72%,var(--fw-bg)_100%)] lg:bg-[linear-gradient(90deg,color-mix(in_oklab,var(--fw-surface)_78%,transparent)_0%,color-mix(in_oklab,var(--fw-surface)_40%,transparent)_38%,transparent_70%)]" />

        <div className="grid flex-1 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10">
          <div className="flex flex-col items-center gap-6 lg:items-start lg:justify-between">
            <div className="flex w-full flex-col items-center gap-3 lg:items-start">
              {profile}
              <h2 id="balance-title" className="text-sm font-medium text-muted">
                {BALANCES_COPY.totalBalance}
              </h2>
              <div
                aria-busy={!balances && !failed}
                className="flex w-full flex-col items-center gap-2 lg:items-start"
              >
                <BalanceFigure balances={balances} failed={failed} onRetry={onRetry} />
                {series ? <Change series={series} rangeName={rangeName} /> : null}
              </div>
            </div>
            <MoneyActions onReceive={onReceive} />
          </div>
          <div className="hidden min-h-0 min-w-0 flex-col gap-3 lg:flex">
            <div className="flex justify-end">{rangeControl}</div>
            <div className="min-h-0 flex-1">{chart(false)}</div>
          </div>
        </div>
      </section>

      <section
        aria-label={chartLabel}
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 lg:hidden"
      >
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
        <span className="font-mono tabular-nums">
          {up ? "+" : "−"}
          {amount} {USD}
        </span>
      </span>
      <span className="text-muted">{rangeName}</span>
    </p>
  );
}
