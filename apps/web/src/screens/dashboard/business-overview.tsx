"use client";

import { useState } from "react";
import {
  useGetBalanceHistoryQuery,
  useGetBalancesQuery,
} from "@/features/balances/api/balances-api";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
} from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { historySeries } from "@/features/balances/lib/balance-history";
import { marketUsd } from "@/features/balances/lib/balances";
import type { HistoryRange } from "@/features/balances/types/balance-history";
import { OwedToYou } from "@/features/invoices/components/owed-to-you";
import { LatestPayments } from "@/features/payments/components/latest-payments";
import { useGetPricesQuery } from "@/features/prices/api/prices-api";
import { PRICES_QUERY } from "@/features/prices/constants/prices";
import { PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can, profileLabel } from "@/features/profiles/lib/profile";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTIONS_MAX,
} from "@/features/transactions/constants/transactions";
import { AssetsCard } from "@/screens/dashboard/assets-card";
import { BalanceCard } from "@/screens/dashboard/balance-card";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { OnItsWayCard } from "@/screens/dashboard/on-its-way-card";
import { OverviewChecklist } from "@/screens/dashboard/overview-checklist";
import { ReceivedCard } from "@/screens/dashboard/received-card";
import { LIVE_QUERY } from "@/shared/config/refresh";

// The C comp's order: what you have and what is coming, then how money came in and what it is in, then who still owes
// you and the latest payments. Every card leads somewhere to act.
export function BusinessOverview() {
  const { profile, openReceive } = useAppSession();
  const [range, setRange] = useState<HistoryRange>(DEFAULT_RANGE);
  const days = HISTORY_RANGES[range];
  const rangeName = BALANCES_COPY.rangeNames[range];
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const history = useGetBalanceHistoryQuery({ profileId: profile.profileId, days }, LIVE_QUERY);
  const priced = useGetPricesQuery(undefined, PRICES_QUERY);
  const latest = useGetTransactionsQuery(
    { profileId: profile.profileId, limit: TRANSACTIONS_MAX },
    LIVE_QUERY,
  );
  const prices = priced.currentData?.prices;
  const now = Date.now();
  const market = (field: "wallet" | "settling" | "held") =>
    balances.currentData ? marketUsd(balances.currentData, field, prices, now) : null;

  // The chart keeps the last range's line, dimmed, while the next loads; the figures wait for their own range.
  const received = history.data ? historySeries(history.data, HISTORY_FIELDS.received) : null;
  const receivedNow = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.received)
    : null;
  const sentNow = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.sent)
    : null;

  // Counted from the latest 100 transfers, so "100+" when they don't reach the range's start. The range starts
  // 00:00 UTC `days` days back, today included, as the history's does.
  const since = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() - (days - 1),
  );
  const items = latest.data?.items ?? [];
  const inRange = items.filter(
    (t) => t.direction === TRANSACTION_DIRECTIONS.in && Date.parse(t.at) >= since,
  );
  const reachesStart = !latest.data?.nextCursor || Date.parse(items.at(-1)?.at ?? "") < since;
  const transfers = latest.data
    ? reachesStart
      ? String(inRange.length)
      : COPY.atLeast(inRange.length)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        <span className="sr-only">{profileLabel(profile)} </span>
        {COPY.overview}
      </h1>

      {profile.kind === PROFILE_KINDS.freelancer ? <OverviewChecklist /> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <BalanceCard
          wallet={market("wallet")}
          loading={!balances.currentData && !balances.isError}
          failed={balances.isError}
          onRetry={() => void balances.refetch()}
          prices={prices}
          pricesRead={Boolean(priced.currentData || priced.isError)}
          merchant={profile.kind === PROFILE_KINDS.merchant}
          canBill={can(profile, PERMISSIONS.invoicesWrite)}
          onReceive={openReceive}
        />
        <OnItsWayCard
          profileId={profile.profileId}
          moving={market("settling")}
          held={market("held")}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ReceivedCard
          range={range}
          days={days}
          onRange={setRange}
          rangeName={rangeName}
          received={received}
          receivedNow={receivedNow}
          sentNow={sentNow}
          transfers={transfers}
          loading={!history.data && !history.isError}
          fetching={history.isFetching && !history.currentData}
          failed={history.isError}
          onRetry={() => void history.refetch()}
        />
        <AssetsCard
          balances={balances.currentData ?? null}
          failed={balances.isError}
          onRetry={() => void balances.refetch()}
          prices={prices}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <OwedToYou profileId={profile.profileId} />
        <LatestPayments profileId={profile.profileId} />
      </div>
    </div>
  );
}
