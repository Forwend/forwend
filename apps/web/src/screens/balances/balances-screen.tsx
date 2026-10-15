"use client";

import { Skeleton } from "@forwend/ui-web";
import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { BalancesList } from "@/features/balances/components/balances-list";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { formatUsd, usdTotal } from "@/features/balances/lib/balances";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export function BalancesScreen() {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const total = balances.currentData ? usdTotal(balances.currentData, "wallet") : null;
  return (
    <div className="flex flex-col gap-6">
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {BALANCES_COPY.balancesTitle}
      </h1>
      <p className="flex flex-col gap-1">
        <span className="text-sm text-muted">{BALANCES_COPY.totalBalance}</span>
        {!balances.currentData && !balances.isError ? (
          <Skeleton className="h-[1.15em] w-48 text-3xl" />
        ) : total === null ? (
          <span className="text-3xl font-semibold text-muted">—</span>
        ) : (
          <span className="flex items-baseline gap-1.5 text-3xl font-semibold tracking-tight text-ink">
            {formatUsd(total)}
            <span className="text-sm font-medium text-muted">{MONEY_COPY.usd}</span>
            <EstimateHint />
          </span>
        )}
      </p>
      <BalancesList
        balances={balances.currentData ?? null}
        failed={balances.isError}
        onRetry={balances.refetch}
      />
    </div>
  );
}
