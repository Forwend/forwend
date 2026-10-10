"use client";

import { BalanceHero } from "@/features/balances/balance-hero";
import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { MoneyFlowCard } from "@/features/balances/money-flow-card";
import { NetworksCard } from "@/features/balances/networks-card";
import { useAppSession } from "@/features/profiles/app-session";
import { ProfilePill } from "@/features/profiles/components/profile-pill";
import { profileLabel } from "@/features/profiles/profile";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { TransactionsTable } from "@/features/transactions/transactions-table";
import { LIVE_QUERY } from "@/shared/config/refresh";

const RECENT = 6;

export function PersonalOverview() {
  const { profile, openReceive, openProfiles } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{profileLabel(profile)} overview</h1>
      <BalanceHero
        profileId={profile.profileId}
        profile={<ProfilePill name={profileLabel(profile)} onClick={openProfiles} />}
        balances={balances.currentData ?? null}
        failed={balances.isError}
        onRetry={balances.refetch}
        onReceive={openReceive}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] xl:items-start">
        <TransactionsTable
          profileId={profile.profileId}
          title={TRANSACTIONS_COPY.recentTransactions}
          preview={RECENT}
        />
        <div className="flex flex-col gap-4">
          <NetworksCard balances={balances.currentData ?? null} />
          <MoneyFlowCard profileId={profile.profileId} />
        </div>
      </div>
    </div>
  );
}
