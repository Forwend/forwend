"use client";

import { useAppSession } from "@/components/app/active-profile";
import { BalancesList } from "@/components/app/balances-list";
import { REFRESH_MS } from "@/constants/app";
import { PROFILE_PAGE_COPY } from "@/constants/profile-page";
import { getBalances } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

export default function BalancesPage() {
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
      <h1 className="font-display text-3xl text-ink sm:text-4xl">
        {PROFILE_PAGE_COPY.balancesTitle}
      </h1>
      <BalancesList balances={balances.data} failed={balances.failed} onRetry={balances.reload} />
    </div>
  );
}
