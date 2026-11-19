"use client";

import {
  Badge,
  Button,
  EmptyState,
  Money,
  PAYMENT_STATUS,
  SearchField,
  StatusPill,
} from "@forwend/ui-web";
import { ArrowDownLeft, FileText, History } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useGetActivityInfiniteQuery } from "@/features/activity/api/activity-api";
import { ACTIVITY_KINDS } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { activityStatus } from "@/features/activity/lib/activity";
import type { ActivityItem } from "@/features/activity/types/activity";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { ChainBadge, hasChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { type DataColumn, DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { ListFilters } from "@/shared/components/list-filters";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";
import { dayTime, timeOfDay } from "@/shared/lib/dates";
import { exactDigits } from "@/shared/lib/money";
import { narrowedBy } from "@/shared/lib/payment-state";
import { paymentStateGroup } from "@/shared/lib/payment-state-filter";

const STATES = Object.values(PAYMENT_STATE_FILTERS);

interface ActivityListProps {
  profileId: string;
  emptyAction?: ReactNode;
}

interface Row {
  item: ActivityItem;
  key: string;
}

const isDeposit = (item: ActivityItem) => item.kind === ACTIVITY_KINDS.deposit;
const isSplit = (item: ActivityItem) =>
  isDeposit(item) &&
  !item.held &&
  Boolean(item.heldAmount && item.merchantAmount && BigInt(item.heldAmount) > 0n);
const anyOption = (item: ActivityItem) => !isDeposit(item) && item.optionCount > 1;

function eventName(item: ActivityItem): string {
  if (!isDeposit(item)) return ACTIVITY_COPY.invoice;
  return item.held ? ACTIVITY_COPY.held : ACTIVITY_COPY.deposit;
}

function forParts(item: ActivityItem): { who: string | null; ref: string | null } {
  return {
    who: item.clientName ?? null,
    ref: item.reference ?? (item.number ? invoiceNumber(item.number) : null) ?? item.title ?? null,
  };
}

function rowTitle(item: ActivityItem): string {
  const { who, ref } = forParts(item);
  const what = isSplit(item) ? ACTIVITY_COPY.partHeld : eventName(item);
  return [what, who, ref].filter(Boolean).join(" · ");
}

const rowHref = (item: ActivityItem) =>
  `${isDeposit(item) ? APP_ROUTES.payments : APP_ROUTES.invoices}/${item.invoiceId}`;

const COLUMNS: DataColumn<Row>[] = [
  {
    key: "event",
    header: ACTIVITY_COPY.columns.event,
    placeholder: "lead",
    title: ({ item }) => rowTitle(item),
    cell: ({ item }) => (
      <span className="flex min-w-0 items-center gap-3">
        <Lead item={item} />
        <span className="truncate font-medium text-ink">
          {eventName(item)}
          <NetworkWords item={item} />
        </span>
        {isSplit(item) ? <Badge tone="neutral">{ACTIVITY_COPY.extraHeld}</Badge> : null}
      </span>
    ),
  },
  {
    key: "for",
    header: ACTIVITY_COPY.columns.for,
    className: "w-48",
    title: ({ item }) => Object.values(forParts(item)).filter(Boolean).join(" · ") || null,
    cell: ({ item }) => <For item={item} />,
  },
  {
    key: "date",
    header: ACTIVITY_COPY.columns.date,
    from: "md",
    fit: true,
    cell: ({ item }) => (
      <span className="inline-flex items-center gap-1 text-muted tabular-nums">
        <time dateTime={item.at}>{dayTime(item.at)}</time>
        {item.txHash ? <ExplorerLink chainId={item.chainId} txHash={item.txHash} /> : null}
      </span>
    ),
  },
  {
    key: "status",
    header: ACTIVITY_COPY.columns.status,
    placeholder: "pill",
    fit: true,
    cell: ({ item }) => <StatusPill quiet status={activityStatus(item)} />,
  },
  {
    key: "amount",
    header: ACTIVITY_COPY.columns.amount,
    align: "end",
    className: "w-40",
    cell: ({ item }) => <Amount item={item} />,
  },
];

// A new list per profile: rows shown while more load are always this profile's.
export function ActivityList(props: ActivityListProps) {
  return <ProfileActivity key={props.profileId} {...props} />;
}

function ProfileActivity({ profileId, emptyAction }: ActivityListProps) {
  const filters = useListFilters("state", STATES, PAYMENT_STATE_FILTERS.all);
  // Polling refetches every loaded page, so only the first page stays live.
  const [pages, setPages] = useState(1);
  const list = useGetActivityInfiniteQuery(
    { profileId, state: filters.apiFilter, q: filters.apiQuery },
    { ...LIVE_QUERY, pollingInterval: pages > 1 ? 0 : LIVE_QUERY.pollingInterval },
  );
  const data = useShownData(filters.key, list.currentData, list.data);
  if ((data?.pages.length ?? 1) !== pages) setPages(data?.pages.length ?? 1);
  // One transaction can pay two invoices, and one invoice twice: the position completes the key.
  const rows: Row[] = (data?.pages.flatMap((page) => page.items) ?? []).map((item, i) => ({
    item,
    key: `${item.kind}:${item.invoiceId}:${item.txHash ?? ""}:${i}`,
  }));
  const noActivity = !filters.filtered && data && rows.length === 0;
  const stale = !list.currentData && Boolean(data);
  const [skeletonRows, setSkeletonRows] = useState(SKELETON_ROWS);
  if (rows.length > 0 && rows.length !== skeletonRows) setSkeletonRows(rows.length);

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={(!data && !list.isError) || stale || undefined}
      className="flex flex-col gap-4"
    >
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
          filter={<ListFilters groups={[paymentStateGroup(filters.filter, filters.setFilter)]} />}
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
        <DataTableSkeleton
          columns={COLUMNS}
          leading
          days
          status
          count={skeletonRows}
          className="fw-panel overflow-hidden"
        />
      ) : noActivity ? (
        <EmptyState
          page
          icon={History}
          title={ACTIVITY_COPY.emptyTitle}
          description={ACTIVITY_COPY.emptyText}
          action={emptyAction}
        />
      ) : rows.length === 0 ? (
        <NoMatch
          page
          onClear={filters.clear}
          title={ACTIVITY_COPY.noMatchTitle}
          description={narrowedBy(filters.apiQuery, filters.filter)}
        />
      ) : (
        <div
          className={
            stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : undefined
          }
        >
          <DataTable
            label={ACTIVITY_COPY.activity}
            rows={rows}
            columns={COLUMNS}
            rowKey={(row) => row.key}
            rowHref={(row) => rowHref(row.item)}
            rowLabel={(row) => rowTitle(row.item)}
            day={(row) => row.item.at}
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
      {list.error && data ? (
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

function Lead({ item, large = false }: { item: ActivityItem; large?: boolean }) {
  const deposit = isDeposit(item);
  const Icon = deposit ? ArrowDownLeft : FileText;
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-pill ${large ? "size-9" : "size-7"} ${deposit && !item.held ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      {anyOption(item) ? null : <ChainBadge chainId={item.chainId} />}
    </span>
  );
}

function NetworkWords({ item }: { item: ActivityItem }) {
  if (anyOption(item)) return <span className="sr-only">, {MONEY_COPY.anyNetwork}</span>;
  return hasChainBadge(item.chainId) ? (
    <span className="sr-only">, {chainName(item.chainId)}</span>
  ) : (
    <span className="font-normal text-muted"> · {chainName(item.chainId)}</span>
  );
}

function For({ item }: { item: ActivityItem }) {
  const { who, ref } = forParts(item);
  if (!who && !ref) return <span className="text-subtle">—</span>;
  return who ? (
    <>
      <span className="text-ink">{who}</span>
      {ref ? <span className="text-muted"> · {ref}</span> : null}
    </>
  ) : (
    <span className="text-ink">{ref}</span>
  );
}

// Money held for the payer is theirs, so it never reads as income.
function Amount({ item }: { item: ActivityItem }) {
  const deposit = isDeposit(item);
  const amount = BigInt(item.amount);
  return (
    <span className={deposit && !item.held ? "text-success" : "text-ink"}>
      <Money
        baseUnits={amount}
        decimals={item.decimals}
        token={anyOption(item) ? MONEY_COPY.usd : item.symbol}
        fractionDigits={exactDigits(amount, item.decimals)}
        sign={deposit ? "+" : ""}
        nowrap
      />
    </span>
  );
}

function phoneRow(item: ActivityItem) {
  const status = activityStatus(item);
  const { who, ref } = forParts(item);
  return {
    leading: <Lead item={item} large />,
    title: (
      <>
        {eventName(item)}
        <NetworkWords item={item} />
      </>
    ),
    time: <time dateTime={item.at}>{timeOfDay(item.at)}</time>,
    value: <Amount item={item} />,
    detail:
      who || ref ? (
        <>
          <For item={item} />
          {isSplit(item) ? ` · ${ACTIVITY_COPY.extraHeldNote}` : null}
        </>
      ) : undefined,
    meta: status === PAYMENT_STATUS.confirmed ? undefined : <StatusPill status={status} />,
  };
}
