"use client";

import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { BalancesList } from "@/features/balances/balances-list";
import { useAppSession } from "@/features/profiles/app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";

export function BalancesScreen() {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl text-ink sm:text-4xl">{BALANCES_COPY.balancesTitle}</h1>
      <BalancesList
        balances={balances.currentData ?? null}
        failed={balances.isError}
        onRetry={balances.refetch}
      />
    </div>
  );
}
