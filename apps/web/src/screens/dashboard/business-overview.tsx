"use client";

import { Button, SegmentedControl, Skeleton } from "@forwend/ui-web";
import { type ReactNode, useState } from "react";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
  type HistoryRange,
  historySeries,
  RANGE_OPTIONS,
  seriesTotal,
} from "@/features/balances/balance-history";
import { formatUsd, USD, usdTotal } from "@/features/balances/balances";
import { useGetBalanceHistoryQuery, useGetBalancesQuery } from "@/features/balances/balances-api";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { EstimateHint } from "@/features/balances/estimate-hint";
import { MoneyFlowCard } from "@/features/balances/money-flow-card";
import { NetworksCard } from "@/features/balances/networks-card";
import { ReceivedChart } from "@/features/balances/received-chart";
import { useAppSession } from "@/features/profiles/app-session";
import { ProfilePill } from "@/features/profiles/components/profile-pill";
import { profileLabel } from "@/features/profiles/profile";
import { TRANSACTION_DIRECTIONS, TRANSACTIONS_MAX } from "@/features/transactions/transactions";
import { useGetTransactionsQuery } from "@/features/transactions/transactions-api";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { TransactionsTable } from "@/features/transactions/transactions-table";
import { LIVE_QUERY } from "@/shared/config/refresh";

const BUSINESS_COPY = {
  overview: "Overview",
  balance: "Balance",
  received: "Received",
  payments: "Payments in",
  pending: "On its way",
  pendingHint: "Paid to invoices, not in the wallet yet",
  atLeast: (n: number) => `${n}+`,
} as const;

export function BusinessOverview() {
  const { profile, openProfiles } = useAppSession();
  const [range, setRange] = useState<HistoryRange>(DEFAULT_RANGE);
  const days = HISTORY_RANGES[range];
  const rangeName = BALANCES_COPY.rangeNames[range];
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const history = useGetBalanceHistoryQuery({ profileId: profile.profileId, days }, LIVE_QUERY);
  const latest = useGetTransactionsQuery(
    { profileId: profile.profileId, limit: TRANSACTIONS_MAX },
    LIVE_QUERY,
  );
  const received = history.data ? historySeries(history.data, HISTORY_FIELDS.received) : null;

  // Payments in over the range, counted from the latest 100 transfers; when those do not reach back to the start of
  // the range, the count shows as "100+". The range starts where the history's does: 00:00 UTC, `days` days back
  // with today included, so the count and Received cover the same days.
  const now = new Date();
  const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1));
  const items = latest.data?.items ?? [];
  const inRange = items.filter(
    (t) => t.direction === TRANSACTION_DIRECTIONS.in && Date.parse(t.at) >= since,
  );
  const reachesStart = !latest.data?.nextCursor || Date.parse(items.at(-1)?.at ?? "") < since;
  const payments = latest.data
    ? reachesStart
      ? String(inRange.length)
      : BUSINESS_COPY.atLeast(inRange.length)
    : null;

  const wallet = balances.currentData ? usdTotal(balances.currentData, "wallet") : null;
  const pending = balances.currentData ? usdTotal(balances.currentData, "pending") : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <ProfilePill name={profileLabel(profile)} onClick={openProfiles} />
          {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
          <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
            <span className="sr-only">{profileLabel(profile)} </span>
            {BUSINESS_COPY.overview}
          </h1>
        </div>
        <SegmentedControl
          label={BALANCES_COPY.chartRange}
          options={RANGE_OPTIONS}
          value={range}
          onValueChange={setRange}
        />
      </div>

      {balances.isError && !balances.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {BALANCES_COPY.balancesFailed}
          <Button size="sm" variant="secondary" onClick={balances.refetch}>
            {BALANCES_COPY.retry}
          </Button>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface lg:grid-cols-4 [&>div]:border-line [&>div:nth-child(n+3)]:border-t lg:[&>div:nth-child(n+3)]:border-t-0 [&>div:nth-child(even)]:border-l lg:[&>div:not(:first-child)]:border-l">
        <Figure label={BUSINESS_COPY.balance} note={BALANCES_COPY.today}>
          {balances.currentData ? <Total cents={wallet} hint /> : null}
        </Figure>
        <Figure label={BUSINESS_COPY.received} note={rangeName}>
          {history.data ? <Total cents={received ? seriesTotal(received) : null} /> : null}
        </Figure>
        <Figure label={BUSINESS_COPY.payments} note={rangeName}>
          {payments}
        </Figure>
        <Figure label={BUSINESS_COPY.pending} note={BUSINESS_COPY.pendingHint}>
          {balances.currentData ? <Total cents={pending} /> : null}
        </Figure>
      </dl>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] xl:items-start">
        <section
          aria-labelledby="received-title"
          className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="received-title" className="text-base font-semibold text-ink">
              {BUSINESS_COPY.received}
            </h2>
            <span className="text-xs text-muted">{rangeName}</span>
          </div>
          <div className="h-64">
            {history.isError && !history.data ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
                {BALANCES_COPY.historyFailed}
                <Button size="sm" variant="secondary" onClick={history.refetch}>
                  {BALANCES_COPY.retry}
                </Button>
              </div>
            ) : !history.data ? (
              <Skeleton className="h-full" />
            ) : !received ? (
              <p className="text-sm text-muted">{BALANCES_COPY.historyUnavailable}</p>
            ) : (
              <ReceivedChart
                series={received}
                label={BALANCES_COPY.receivedOver(rangeName)}
                className={`h-full transition-opacity duration-[var(--fw-duration-base)] ${history.isFetching ? "opacity-60" : ""}`}
              />
            )}
          </div>
        </section>
        <div className="flex flex-col gap-4">
          <NetworksCard balances={balances.currentData ?? null} />
          <MoneyFlowCard profileId={profile.profileId} />
        </div>
      </div>

      <TransactionsTable profileId={profile.profileId} title={TRANSACTIONS_COPY.payments} />
    </div>
  );
}

function Figure({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:px-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
        {children ?? <Skeleton className="h-8 w-28" />}
      </dd>
      <dd className="truncate text-xs text-subtle">{note}</dd>
    </div>
  );
}

function Total({ cents, hint = false }: { cents: bigint | null; hint?: boolean }) {
  if (cents === null) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      {formatUsd(cents)}
      <span className="text-sm font-medium text-muted">{USD}</span>
      {hint ? <EstimateHint /> : null}
    </span>
  );
}
