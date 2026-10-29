"use client";

import { BigAmount, Skeleton } from "@forwend/ui-web";
import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { BalancesList } from "@/features/balances/components/balances-list";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { formatUsd, marketUsd } from "@/features/balances/lib/balances";
import { useGetPricesQuery } from "@/features/prices/api/prices-api";
import { PricesUpdated } from "@/features/prices/components/prices-updated";
import { PRICES_QUERY } from "@/features/prices/constants/prices";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export function BalancesScreen() {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const priced = useGetPricesQuery(undefined, PRICES_QUERY);
  const total = balances.currentData
    ? marketUsd(balances.currentData, "wallet", priced.currentData?.prices, Date.now())
    : null;
  return (
    <div className="flex flex-col gap-6">
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {BALANCES_COPY.balancesTitle}
      </h1>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">{BALANCES_COPY.totalBalance}</span>
        {!balances.currentData && !balances.isError ? (
          <Skeleton className="h-[1.15em] w-56 text-4xl" />
        ) : total === null ? (
          <span className="text-3xl font-semibold text-muted">—</span>
        ) : (
          <span className="flex items-baseline gap-1.5 text-ink">
            <BigAmount value={formatUsd(total)} className="text-4xl" />
            <span className="text-sm text-subtle">{MONEY_COPY.usd}</span>
            <EstimateHint />
          </span>
        )}
        {priced.currentData || priced.isError ? (
          <PricesUpdated prices={priced.currentData?.prices} staleOnly />
        ) : null}
      </div>
      <BalancesList
        balances={balances.currentData ?? null}
        prices={priced.currentData?.prices}
        failed={balances.isError}
        onRetry={balances.refetch}
      />
      {priced.currentData || priced.isError ? (
        <footer className="flex justify-end">
          <PricesUpdated prices={priced.currentData?.prices} />
        </footer>
      ) : null}
    </div>
  );
}
