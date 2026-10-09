"use client";

import { getBalances } from "@/features/balances/balances-api";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { BalancesList } from "@/features/balances/balances-list";
import { useAppSession } from "@/features/profiles/app-session";
import { REFRESH_MS } from "@/shared/config/refresh";
import { useLoad } from "@/shared/hooks/use-load";

export function BalancesScreen() {
  const { profile, token } = useAppSession();
  const balances = useLoad(
    async () => getBalances(await token(), profile.profileId),
    [profile.profileId],
    {
      refreshMs: REFRESH_MS,
      resetKey: profile.profileId,
    },
  );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl text-ink sm:text-4xl">{BALANCES_COPY.balancesTitle}</h1>
      <BalancesList balances={balances.data} failed={balances.failed} onRetry={balances.reload} />
    </div>
  );
}
