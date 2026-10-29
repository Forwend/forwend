"use client";

import { Skeleton } from "@forwend/ui-web";
import Image from "next/image";
import { useGetBalanceHistoryQuery } from "@/features/balances/api/balances-api";
import { BalanceChange } from "@/features/balances/components/balance-change";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import { MoneyActions } from "@/features/balances/components/money-actions";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
} from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { historySeries } from "@/features/balances/lib/balance-history";
import type { Balances } from "@/features/balances/types/balances";
import { useGetPricesQuery } from "@/features/prices/api/prices-api";
import { PRICES_QUERY } from "@/features/prices/constants/prices";
import { HERO_IMAGE } from "@/shared/assets/images";
import { LIVE_QUERY } from "@/shared/config/refresh";

export interface BalanceHeroProps {
  profileId: string;
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
  onReceive: () => void;
  onRequest: () => void;
}

/** The personal balance card: the total and its change over the past month, then the round money actions. */
export function BalanceHero({
  profileId,
  balances,
  failed,
  onRetry,
  onReceive,
  onRequest,
}: BalanceHeroProps) {
  const priced = useGetPricesQuery(undefined, PRICES_QUERY);
  // The same read as the chart card's default range, so it comes from the cache.
  const history = useGetBalanceHistoryQuery(
    { profileId, days: HISTORY_RANGES[DEFAULT_RANGE] },
    LIVE_QUERY,
  );
  const series = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.balances)
    : null;

  return (
    <section
      aria-labelledby="balance-title"
      className="relative isolate -mx-4 -mt-4 flex min-h-80 flex-col overflow-hidden border-b border-line bg-surface sm:mx-0 sm:mt-0 sm:min-h-64 sm:rounded-lg sm:border"
    >
      {/* One artwork in both themes; dark mode mutes it toward the near-black ground (D-113). */}
      <Image
        src={HERO_IMAGE.src}
        alt=""
        fill
        priority
        sizes="(min-width: 64rem) 60vw, 100vw"
        className="-z-10 object-cover object-right saturate-[.8] dark:brightness-[.45] dark:contrast-[1.1] dark:grayscale-[.7] dark:saturate-100"
      />
      {/* The veil keeps the figures on the surface: on phones over the whole card, from small screens the art shows
          only on the right. */}
      <div className="absolute inset-0 -z-10 bg-[color-mix(in_oklab,var(--fw-surface)_78%,transparent)] sm:bg-transparent sm:bg-[linear-gradient(90deg,var(--fw-surface)_30%,color-mix(in_oklab,var(--fw-surface)_55%,transparent)_62%,transparent)] dark:sm:bg-[linear-gradient(90deg,var(--fw-surface)_30%,color-mix(in_oklab,var(--fw-surface)_60%,transparent)_62%,color-mix(in_oklab,var(--fw-surface)_15%,transparent))]" />

      <div className="flex flex-1 flex-col items-center gap-6 px-4 py-8 sm:items-start sm:p-6">
        <div className="@container flex w-full flex-col items-center gap-2 sm:max-w-md sm:items-start">
          <h2 id="balance-title" className="text-sm text-muted">
            {BALANCES_COPY.totalBalance}
          </h2>
          <div
            aria-busy={!balances && !failed}
            className="flex w-full flex-col items-center gap-1.5 sm:items-start"
          >
            <BalanceFigure
              balances={balances}
              prices={priced.currentData?.prices}
              failed={failed}
              onRetry={onRetry}
              change={
                series ? (
                  <BalanceChange series={series} />
                ) : history.currentData || history.isError ? null : (
                  <Skeleton className="h-5 w-40" />
                )
              }
            />
          </div>
        </div>
        <div className="mt-auto w-full">
          <MoneyActions onReceive={onReceive} onRequest={onRequest} />
        </div>
      </div>
    </section>
  );
}
