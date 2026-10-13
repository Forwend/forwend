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
import { ReceivedChart } from "@/features/balances/charts/received-chart";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { MoneyFlowCard } from "@/features/balances/components/money-flow-card";
import { NetworksCard } from "@/features/balances/components/networks-card";
import { useAppSession } from "@/features/profiles/app-session";
import { ProfilePill } from "@/features/profiles/components/profile-pill";
import { PROFILE_KINDS, profileLabel } from "@/features/profiles/profile";
import { TRANSACTION_DIRECTIONS, TRANSACTIONS_MAX } from "@/features/transactions/transactions";
import { useGetTransactionsQuery } from "@/features/transactions/transactions-api";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { TransactionsTable } from "@/features/transactions/transactions-table";
import { OverviewChecklist } from "@/screens/dashboard/overview-checklist";
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
// The full list with filters, search and export is the Transactions page.
const RECENT = 8;

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
  // The chart keeps the last range's bars, dimmed, while the next loads; figures for the range wait for their own data.
  const received = history.data ? historySeries(history.data, HISTORY_FIELDS.received) : null;
  const receivedNow = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.received)
    : null;
  const balancesFailed = balances.isError && !balances.currentData;
  const historyFailed = history.isError && !history.currentData;

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

      {profile.kind === PROFILE_KINDS.freelancer ? <OverviewChecklist /> : null}

      {balancesFailed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {BALANCES_COPY.balancesFailed}
          <Button size="sm" variant="secondary" onClick={balances.refetch}>
            {BALANCES_COPY.retry}
          </Button>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface lg:grid-cols-4 [&>div]:border-line [&>div:nth-child(n+3)]:border-t lg:[&>div:nth-child(n+3)]:border-t-0 [&>div:nth-child(even)]:border-l lg:[&>div:not(:first-child)]:border-l">
        <Figure label={BUSINESS_COPY.balance} note={BALANCES_COPY.today} failed={balancesFailed}>
          {balances.currentData ? <Total cents={wallet} hint /> : null}
        </Figure>
        <Figure label={BUSINESS_COPY.received} note={rangeName} failed={historyFailed}>
          {history.currentData ? (
            <Total cents={receivedNow ? seriesTotal(receivedNow) : null} />
          ) : null}
        </Figure>
        <Figure
          label={BUSINESS_COPY.payments}
          note={rangeName}
          failed={latest.isError && !latest.data}
        >
          {payments}
        </Figure>
        <Figure
          label={BUSINESS_COPY.pending}
          note={BUSINESS_COPY.pendingHint}
          failed={balancesFailed}
        >
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
            {historyFailed ? (
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
            ) : seriesTotal(received) === 0n ? (
              history.currentData ? (
                <p className="grid h-full place-items-center text-sm text-muted">
                  {BALANCES_COPY.noneReceived(rangeName)}
                </p>
              ) : (
                <Skeleton className="h-full" />
              )
            ) : (
              <ReceivedChart
                series={received}
                label={BALANCES_COPY.receivedOver(rangeName)}
                className={`h-full transition-opacity duration-[var(--fw-duration-base)] ${history.isFetching && !history.currentData ? "opacity-60" : ""}`}
              />
            )}
          </div>
        </section>
        <div className="flex flex-col gap-4">
          <NetworksCard balances={balances.currentData ?? null} failed={balances.isError} />
          <MoneyFlowCard profileId={profile.profileId} />
        </div>
      </div>

      <TransactionsTable
        profileId={profile.profileId}
        title={TRANSACTIONS_COPY.payments}
        preview={RECENT}
      />
    </div>
  );
}

function Figure({
  label,
  note,
  failed,
  children,
}: {
  label: string;
  note: string;
  failed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="@container flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:px-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-[length:clamp(1.25rem,11cqi,1.5rem)] leading-tight font-semibold tracking-tight text-ink">
        {children ??
          (failed ? (
            <span className="text-muted">—</span>
          ) : (
            <Skeleton className="h-[1.25em] w-28 max-w-full" />
          ))}
      </dd>
      <dd className="truncate text-xs text-subtle">{note}</dd>
    </div>
  );
}

function Total({ cents, hint = false }: { cents: bigint | null; hint?: boolean }) {
  if (cents === null) return <span className="text-muted">—</span>;
  return (
    <span>
      {formatUsd(cents)}{" "}
      <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-muted">
        {USD}
        {hint ? <EstimateHint /> : null}
      </span>
    </span>
  );
}
