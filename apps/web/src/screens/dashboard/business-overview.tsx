"use client";

import { Button, SegmentedControl, Skeleton } from "@forwend/ui-web";
import { type ReactNode, useState } from "react";
import {
  useGetBalanceHistoryQuery,
  useGetBalancesQuery,
} from "@/features/balances/api/balances-api";
import { ReceivedChart } from "@/features/balances/components/charts/received-chart";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { NetworksCard } from "@/features/balances/components/networks-card";
import {
  DEFAULT_RANGE,
  HISTORY_FIELDS,
  HISTORY_RANGES,
  RANGE_OPTIONS,
} from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { historySeries, seriesTotal } from "@/features/balances/lib/balance-history";
import { formatUsd, usdTotal } from "@/features/balances/lib/balances";
import type { HistoryRange } from "@/features/balances/types/balance-history";
import { OwedToYou } from "@/features/invoices/components/owed-to-you";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { profileLabel } from "@/features/profiles/lib/profile";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTIONS_MAX,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { OverviewChecklist } from "@/screens/dashboard/overview-checklist";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const BUSINESS_COPY = {
  overview: "Overview",
  balance: "Balance",
  summary: "Summary",
  received: "Received",
  sent: "Sent",
  payments: (count: string) => `${count} payments in`,
  pending: "On its way",
  pendingHint: "Paid to invoices, not in the wallet yet",
  atLeast: (n: number) => `${n}+`,
} as const;
// The full list with filters, search and export is the Transactions page.
const RECENT = 8;

export function BusinessOverview() {
  const { profile } = useAppSession();
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
  const sentNow = history.currentData
    ? historySeries(history.currentData, HISTORY_FIELDS.sent)
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
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        <span className="sr-only">{profileLabel(profile)} </span>
        {BUSINESS_COPY.overview}
      </h1>

      {profile.kind === PROFILE_KINDS.freelancer ? <OverviewChecklist /> : null}

      {balancesFailed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {BALANCES_COPY.balancesFailed}
          <Button size="sm" variant="secondary" onClick={balances.refetch}>
            {BALANCES_COPY.retry}
          </Button>
        </div>
      ) : null}

      {/* The range belongs to the figures and the chart, so it sits in the summary's header, not alone on a row. */}
      <section aria-labelledby="summary-title" className="fw-panel overflow-hidden">
        <div className="fw-panel-head justify-between">
          <h2 id="summary-title" className="text-base font-semibold text-ink">
            {BUSINESS_COPY.summary}
            <span className="font-normal text-muted max-sm:sr-only"> · {rangeName}</span>
          </h2>
          <SegmentedControl
            label={BALANCES_COPY.chartRange}
            options={RANGE_OPTIONS}
            value={range}
            onValueChange={setRange}
            size="sm"
          />
        </div>
        {/* Phones: one row per figure, the value on the right, so no amount wraps; then two by two, then one row. */}
        <dl className="grid grid-cols-1 pb-1 sm:grid-cols-2 sm:pb-0 lg:grid-cols-4 [&>div]:border-line max-sm:[&>div:not(:first-child)]:border-t sm:[&>div:nth-child(n+3)]:border-t lg:[&>div:nth-child(n+3)]:border-t-0 sm:[&>div:nth-child(even)]:border-l lg:[&>div:not(:first-child)]:border-l">
          <Figure label={BUSINESS_COPY.balance} note={BALANCES_COPY.today} failed={balancesFailed}>
            {balances.currentData ? <Total cents={wallet} hint /> : null}
          </Figure>
          <Figure label={BUSINESS_COPY.received} note={rangeName} failed={historyFailed}>
            {history.currentData ? (
              <Total cents={receivedNow ? seriesTotal(receivedNow) : null} />
            ) : null}
          </Figure>
          <Figure label={BUSINESS_COPY.sent} note={rangeName} failed={historyFailed}>
            {history.currentData ? <Total cents={sentNow ? seriesTotal(sentNow) : null} /> : null}
          </Figure>
          <Figure
            label={BUSINESS_COPY.pending}
            note={BUSINESS_COPY.pendingHint}
            failed={balancesFailed}
          >
            {balances.currentData ? <Total cents={pending} /> : null}
          </Figure>
        </dl>
      </section>

      <OwedToYou profileId={profile.profileId} />

      {/* Both columns stretch to one height, so their bottom edges line up. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <section aria-labelledby="received-title" className="fw-panel flex flex-col">
          <div className="fw-panel-head flex-wrap justify-between gap-y-1">
            <h2 id="received-title" className="text-base font-semibold text-ink">
              {BUSINESS_COPY.received}
            </h2>
            <span className="text-xs text-muted">
              {payments === null ? rangeName : `${BUSINESS_COPY.payments(payments)} · ${rangeName}`}
            </span>
          </div>
          {/* At least 12rem on a phone and 16rem wider, and taller when the side column is, so the chart fills its
              panel. */}
          <div className="grid min-h-48 flex-1 sm:min-h-64 grid-rows-[minmax(0,1fr)] p-4 sm:p-5">
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
        <NetworksCard balances={balances.currentData ?? null} failed={balances.isError} />
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
    <div className="@container grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-4 py-3 sm:flex sm:flex-col sm:gap-1.5 sm:px-5 sm:py-4">
      <dt className="text-sm text-ink sm:text-muted">{label}</dt>
      <dd className="col-start-2 row-span-2 row-start-1 self-center text-right sm:self-start text-lg leading-tight font-semibold tracking-tight text-ink tabular-nums sm:text-left sm:text-[length:clamp(1.25rem,11cqi,1.5rem)]">
        {children ??
          (failed ? (
            <span className="text-muted">—</span>
          ) : (
            <Skeleton className="h-[1.25em] w-28 max-w-full" />
          ))}
      </dd>
      <dd className="min-w-0 text-xs text-subtle">{note}</dd>
    </div>
  );
}

function Total({ cents, hint = false }: { cents: bigint | null; hint?: boolean }) {
  if (cents === null) return <span className="text-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      {formatUsd(cents)}{" "}
      <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-muted">
        {MONEY_COPY.usd}
        {hint ? <EstimateHint /> : null}
      </span>
    </span>
  );
}
