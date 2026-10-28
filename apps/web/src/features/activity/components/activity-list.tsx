"use client";

import {
  ACTIVITY_DIRECTIONS,
  ActivityRow,
  Button,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
} from "@forwend/ui-web";
import { History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useGetActivityInfiniteQuery } from "@/features/activity/api/activity-api";
import { StatusFilter } from "@/features/activity/components/status-filter";
import { ACTIVITY_KINDS, STATUS_FILTERS } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { activityStatus } from "@/features/activity/lib/activity";
import type { ActivityItem } from "@/features/activity/types/activity";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { ChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { CHAINS } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// An invoice is a request, so its amount has no sign; only a payment shows "+".
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

// A new list per profile: the rows shown while more load are always this profile's.
export function ActivityList(props: ActivityListProps) {
  return <ProfileActivity key={props.profileId} {...props} />;
}

function ProfileActivity({ profileId }: ActivityListProps) {
  const filters = useListFilters("status", Object.values(STATUS_FILTERS), STATUS_FILTERS.all);
  // Polling refetches every loaded page, so the list stays live only while it shows its first page.
  const [pages, setPages] = useState(1);
  const list = useGetActivityInfiniteQuery(
    { profileId, status: filters.apiFilter, q: filters.apiQuery },
    { ...LIVE_QUERY, pollingInterval: pages > 1 ? 0 : LIVE_QUERY.pollingInterval },
  );
  const data = useShownData(filters.key, list.currentData, list.data);
  if ((data?.pages.length ?? 1) !== pages) setPages(data?.pages.length ?? 1);
  const rows = data?.pages.flatMap((page) => page.items) ?? [];
  const noActivity = !filters.filtered && data && rows.length === 0;
  // A new filter or search loads in place of as many rows as were shown.
  const [skeletonRows, setSkeletonRows] = useState(SKELETON_ROWS);
  if (rows.length > 0 && rows.length !== skeletonRows) setSkeletonRows(rows.length);

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={!data && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 id="activity-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {ACTIVITY_COPY.activity}
      </h1>
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
          filter={<StatusFilter value={filters.filter} onValueChange={filters.setFilter} />}
        />
      ) : null}
      {list.isError && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
          {ACTIVITY_COPY.activityFailed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {ACTIVITY_COPY.retry}
          </Button>
        </div>
      ) : !data ? (
        <RowsSkeleton count={skeletonRows} className="fw-panel overflow-hidden" />
      ) : noActivity ? (
        <EmptyState
          icon={History}
          title={ACTIVITY_COPY.emptyTitle}
          description={ACTIVITY_COPY.emptyText}
        />
      ) : (
        <>
          {rows.length === 0 ? (
            <NoMatch onClear={filters.clear} />
          ) : (
            <ul className="fw-panel divide-y divide-line overflow-hidden">
              {rows.map((item, i) => {
                const deposit = item.kind === ACTIVITY_KINDS.deposit;
                // A client-chooses invoice reads in USD on any network, as in the invoice list (R-70).
                const anyOption = !deposit && item.optionCount > 1;
                return (
                  <li
                    // The same transaction can pay two invoices, and one invoice can get two payments in it.
                    // biome-ignore lint/suspicious/noArrayIndexKey: the position completes the key
                    key={`${item.kind}:${item.invoiceId}:${item.txHash ?? ""}:${i}`}
                    className={`relative px-4 transition-colors duration-[var(--fw-duration-fast)] sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <ActivityRow
                      title={
                        <Link
                          href={`${deposit ? APP_ROUTES.payments : APP_ROUTES.invoices}/${item.invoiceId}`}
                          className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                        >
                          {rowTitle(item)}
                        </Link>
                      }
                      // Phones show the network as a logo on the icon, so the time never gets cut.
                      detail={
                        anyOption || !CHAINS[item.chainId]?.icon ? (
                          `${anyOption ? MONEY_COPY.anyNetwork : chainName(item.chainId)} · ${TIME.format(new Date(item.at))}`
                        ) : (
                          <>
                            <span className="max-sm:sr-only">{chainName(item.chainId)} · </span>
                            {TIME.format(new Date(item.at))}
                          </>
                        )
                      }
                      badge={
                        !anyOption && CHAINS[item.chainId]?.icon ? (
                          <ChainBadge chainId={item.chainId} className="sm:hidden" />
                        ) : null
                      }
                      direction={
                        deposit ? ACTIVITY_DIRECTIONS.incoming : ACTIVITY_DIRECTIONS.request
                      }
                      amount={{
                        baseUnits: BigInt(item.amount),
                        decimals: item.decimals,
                        token: anyOption ? MONEY_COPY.usd : item.symbol,
                        fractionDigits: exactDigits(BigInt(item.amount), item.decimals),
                      }}
                      status={activityStatus(item)}
                      action={
                        item.txHash ? (
                          <ExplorerLink
                            chainId={item.chainId}
                            txHash={item.txHash}
                            className="relative"
                          />
                        ) : null
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {ACTIVITY_COPY.loadMore}
            </Button>
          ) : null}
          {list.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
              {ACTIVITY_COPY.updateFailed}
              <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
                {ACTIVITY_COPY.retry}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
