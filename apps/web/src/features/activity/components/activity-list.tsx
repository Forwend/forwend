"use client";

import {
  Button,
  EmptyState,
  Money,
  PAYMENT_STATUS,
  SearchField,
  StatusPill,
} from "@forwend/ui-web";
import { ArrowDownLeft, FileText, History } from "lucide-react";
import { useState } from "react";
import { useGetActivityInfiniteQuery } from "@/features/activity/api/activity-api";
import { ACTIVITY_KINDS } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { activityStatus } from "@/features/activity/lib/activity";
import type { ActivityItem } from "@/features/activity/types/activity";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { ChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { DataTable } from "@/shared/components/data-table";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { PaymentStateFilter } from "@/shared/components/payment-state-filter";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { CHAINS } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const STATES = Object.values(PAYMENT_STATE_FILTERS);
const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface ActivityListProps {
  profileId: string;
}

/** What happened, then who and what for, so two rows on one day never read the same. */
function rowTitle(item: ActivityItem): string {
  const deposit = item.kind === ACTIVITY_KINDS.deposit;
  const split = Boolean(item.heldAmount && item.merchantAmount && BigInt(item.heldAmount) > 0n);
  const what = deposit
    ? item.held
      ? ACTIVITY_COPY.held
      : split
        ? ACTIVITY_COPY.partHeld
        : ACTIVITY_COPY.deposit
    : ACTIVITY_COPY.invoice;
  const who =
    item.clientName ?? item.reference ?? (item.number ? invoiceNumber(item.number) : item.title);
  return who ? `${what} · ${who}` : what;
}

// A deposit opens its payment, an invoice row its invoice.
const rowHref = (item: ActivityItem) =>
  `${item.kind === ACTIVITY_KINDS.deposit ? APP_ROUTES.payments : APP_ROUTES.invoices}/${item.invoiceId}`;

// A new list per profile: the rows shown while more load are always this profile's.
export function ActivityList(props: ActivityListProps) {
  return <ProfileActivity key={props.profileId} {...props} />;
}

function ProfileActivity({ profileId }: ActivityListProps) {
  const filters = useListFilters("state", STATES, PAYMENT_STATE_FILTERS.all);
  // Polling refetches every loaded page, so the list stays live only while it shows its first page.
  const [pages, setPages] = useState(1);
  const list = useGetActivityInfiniteQuery(
    { profileId, state: filters.apiFilter, q: filters.apiQuery },
    { ...LIVE_QUERY, pollingInterval: pages > 1 ? 0 : LIVE_QUERY.pollingInterval },
  );
  const data = useShownData(filters.key, list.currentData, list.data);
  if ((data?.pages.length ?? 1) !== pages) setPages(data?.pages.length ?? 1);
  // The same transaction can pay two invoices, and one invoice can get two payments in it: the position completes the key.
  const rows = (data?.pages.flatMap((page) => page.items) ?? []).map((item, i) => ({
    item,
    key: `${item.kind}:${item.invoiceId}:${item.txHash ?? ""}:${i}`,
  }));
  const noActivity = !filters.filtered && data && rows.length === 0;
  const stale = !list.currentData && Boolean(data);
  // A new filter or search loads in place of as many rows as were shown.
  const [skeletonRows, setSkeletonRows] = useState(SKELETON_ROWS);
  if (rows.length > 0 && rows.length !== skeletonRows) setSkeletonRows(rows.length);

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={(!data && !list.isError) || stale || undefined}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 id="activity-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {ACTIVITY_COPY.activity}
      </h1>
      {!noActivity ? (
        <p className="-mt-2 text-sm text-muted lg:mt-0">{ACTIVITY_COPY.intro}</p>
      ) : null}
      {!noActivity ? (
        <ListToolbar
          search={
            <SearchField
              label={ACTIVITY_COPY.search}
              value={filters.search}
              onValueChange={filters.setSearch}
              placeholder={ACTIVITY_COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          filter={<PaymentStateFilter value={filters.filter} onValueChange={filters.setFilter} />}
        />
      ) : null}
      {list.isError && !data ? (
        <LoadError
          page
          message={ACTIVITY_COPY.activityFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !data ? (
        <RowsSkeleton count={skeletonRows} className="fw-panel overflow-hidden" />
      ) : noActivity ? (
        <EmptyState
          page
          icon={History}
          title={ACTIVITY_COPY.emptyTitle}
          description={ACTIVITY_COPY.emptyText}
        />
      ) : rows.length === 0 ? (
        <NoMatch page onClear={filters.clear} />
      ) : (
        <div
          className={
            stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : undefined
          }
        >
          {/* A feed of events, not records with columns: two short lines at every width. */}
          <DataTable
            label={ACTIVITY_COPY.activity}
            rows={rows}
            columns={[
              {
                key: "event",
                header: ACTIVITY_COPY.columns.event,
                title: ({ item }) => rowTitle(item),
                cell: ({ item }) => (
                  <span className="flex min-w-0 items-center gap-3">
                    <Lead item={item} />
                    <span className="truncate font-medium text-ink">{rowTitle(item)}</span>
                  </span>
                ),
              },
              {
                key: "network",
                header: ACTIVITY_COPY.columns.network,
                from: "lg",
                className: "w-40",
                cell: ({ item }) => (
                  <span className="text-muted">
                    {item.kind !== ACTIVITY_KINDS.deposit && item.optionCount > 1 ? (
                      MONEY_COPY.anyNetwork
                    ) : (
                      <NetworkName chainId={item.chainId} />
                    )}
                  </span>
                ),
              },
              {
                key: "when",
                header: ACTIVITY_COPY.columns.when,
                from: "md",
                className: "w-40",
                cell: ({ item }) => (
                  <time dateTime={item.at} className="text-muted">
                    {TIME.format(new Date(item.at))}
                  </time>
                ),
              },
              {
                key: "status",
                header: ACTIVITY_COPY.columns.status,
                className: "w-48",
                cell: ({ item }) => <Status item={item} />,
              },
              {
                key: "amount",
                header: ACTIVITY_COPY.columns.amount,
                align: "end",
                className: "w-36 whitespace-nowrap",
                cell: ({ item }) => <Amount item={item} />,
              },
            ]}
            rowKey={(row) => row.key}
            rowHref={(row) => rowHref(row.item)}
            rowLabel={(row) => rowTitle(row.item)}
            phone={({ item }) => phoneRow(item)}
            footer={
              list.hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {ACTIVITY_COPY.loadMore}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {list.isError && data ? (
        <LoadError
          inline
          message={ACTIVITY_COPY.updateFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : null}
    </section>
  );
}

const networkOf = (item: ActivityItem) =>
  item.kind !== ACTIVITY_KINDS.deposit && item.optionCount > 1
    ? MONEY_COPY.anyNetwork
    : chainName(item.chainId);

function Lead({ item, badge }: { item: ActivityItem; badge?: boolean }) {
  const deposit = item.kind === ACTIVITY_KINDS.deposit;
  const Icon = deposit ? ArrowDownLeft : FileText;
  return (
    <span
      className={`relative grid size-8 shrink-0 place-items-center rounded-pill ${deposit && !item.held ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      {badge ? <ChainBadge chainId={item.chainId} className="sm:hidden" /> : null}
    </span>
  );
}

// An invoice is a request, so its amount has no sign; only a payment shows "+". Money held for the payer is
// theirs, so it never reads as income.
function Amount({ item }: { item: ActivityItem }) {
  const deposit = item.kind === ACTIVITY_KINDS.deposit;
  const anyOption = !deposit && item.optionCount > 1;
  const amount = BigInt(item.amount);
  return (
    <span className={deposit && !item.held ? "text-success" : "text-ink"}>
      <Money
        baseUnits={amount}
        decimals={item.decimals}
        token={anyOption ? MONEY_COPY.usd : item.symbol}
        fractionDigits={exactDigits(amount, item.decimals)}
        sign={deposit ? "+" : ""}
      />
    </span>
  );
}

function Status({ item }: { item: ActivityItem }) {
  const status = activityStatus(item);
  return (
    <span className="flex items-center gap-1">
      <StatusPill quiet status={status} />
      {item.txHash ? <ExplorerLink chainId={item.chainId} txHash={item.txHash} /> : null}
    </span>
  );
}

function phoneRow(item: ActivityItem) {
  const badge =
    (item.kind === ACTIVITY_KINDS.deposit || item.optionCount <= 1) &&
    Boolean(CHAINS[item.chainId]?.icon);
  const time = TIME.format(new Date(item.at));
  return {
    leading: <Lead item={item} badge={badge} />,
    title: rowTitle(item),
    // Phones show the network as a logo on the icon, so the time never gets cut.
    detail: badge ? time : `${networkOf(item)} · ${time}`,
    value: <Amount item={item} />,
    meta:
      activityStatus(item) === PAYMENT_STATUS.confirmed ? undefined : (
        <StatusPill status={activityStatus(item)} />
      ),
  };
}
