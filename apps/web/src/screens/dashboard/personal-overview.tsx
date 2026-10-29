"use client";

import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { BalanceHero } from "@/features/balances/components/balance-hero";
import { BalanceHistoryCard } from "@/features/balances/components/balance-history-card";
import { MoneyFlowCard } from "@/features/balances/components/money-flow-card";
import { useGetPricesQuery } from "@/features/prices/api/prices-api";
import { PRICES_QUERY } from "@/features/prices/constants/prices";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { profileLabel } from "@/features/profiles/lib/profile";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { AssetsCard } from "@/screens/dashboard/assets-card";
import { OverviewChecklist } from "@/screens/dashboard/overview-checklist";
import { LIVE_QUERY } from "@/shared/config/refresh";

const RECENT = 6;
const ROW = "grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]";

export function PersonalOverview() {
  const { profile, openReceive, openRequest } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  // The same cached read the balance figure makes: no second request.
  const priced = useGetPricesQuery(undefined, PRICES_QUERY);
  // Two rows as on the business overview: the balance beside the assets it holds, then its history beside the flow.
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{profileLabel(profile)} overview</h1>
      <div className={ROW}>
        <BalanceHero
          profileId={profile.profileId}
          balances={balances.currentData ?? null}
          failed={balances.isError}
          onRetry={balances.refetch}
          onReceive={openReceive}
          onRequest={openRequest}
        />
        <AssetsCard
          balances={balances.currentData ?? null}
          failed={balances.isError}
          onRetry={() => void balances.refetch()}
          prices={priced.currentData?.prices}
        />
      </div>
      <OverviewChecklist />
      <div className={ROW}>
        <BalanceHistoryCard profileId={profile.profileId} />
        <MoneyFlowCard profileId={profile.profileId} />
      </div>
      <TransactionsTable
        profileId={profile.profileId}
        title={TRANSACTIONS_COPY.recentTransactions}
        preview={RECENT}
      />
    </div>
  );
}
