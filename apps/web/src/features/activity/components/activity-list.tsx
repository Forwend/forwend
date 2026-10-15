"use client";

import {
  ACTIVITY_DIRECTIONS,
  ActivityRow,
  Button,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
  SegmentedControl,
} from "@forwend/ui-web";
import { History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useGetActivityQuery } from "@/features/activity/api/activity-api";
import {
  ACTIVITY_KINDS,
  ACTIVITY_MAX,
  ACTIVITY_PAGE_SIZE,
  STATUS_FILTERS,
} from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { activityStatus } from "@/features/activity/lib/activity";
import { ChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { CHAINS } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

// Short enough for a phone row: "Oct 10, 12:50 AM".
const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Invoices and their payments, newest first, read again every REFRESH_MS. "Show more" asks for more rows in one
// request (up to the API's 100), so a refresh reads the same rows again and never skips or repeats one. An invoice is
// a request, so its amount has no sign; only a payment shows "+". Every row opens its invoice; a payment also links to
// its transaction. The API applies the filter and search, so "Show more" continues the filtered list.
interface ActivityListProps {
  profileId: string;
}

// A new list per profile: the rows shown while more load are always this profile's.
export function ActivityList(props: ActivityListProps) {
  return <ProfileActivity key={props.profileId} {...props} />;
}

function ProfileActivity({ profileId }: ActivityListProps) {
  const [limit, setLimit] = useState<number>(ACTIVITY_PAGE_SIZE);
  const filters = useListFilters("status", Object.values(STATUS_FILTERS), STATUS_FILTERS.all);
  const list = useGetActivityQuery(
    { profileId, limit, status: filters.apiFilter, q: filters.apiQuery },
    LIVE_QUERY,
  );
  const data = useShownData(filters.key, list.currentData, list.data);
  const rows = data?.items ?? [];
  const noActivity = !filters.filtered && data && rows.length === 0;
  const more = Boolean(data?.nextCursor);
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
      {list.data && !noActivity ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Phones: the search first, the filter on its own row below. */}
          <SegmentedControl
            label={ACTIVITY_COPY.filterLabel}
            className="max-sm:order-last"
            value={filters.filter}
            onValueChange={filters.setFilter}
            options={Object.values(STATUS_FILTERS).map((value) => ({
              value,
              label: ACTIVITY_COPY.filters[value],
            }))}
          />
          <SearchField
            label={ACTIVITY_COPY.search}
            value={filters.search}
            onValueChange={filters.setSearch}
            placeholder={ACTIVITY_COPY.searchPlaceholder}
            className="flex-1 max-sm:basis-full sm:max-w-72"
          />
        </div>
      ) : null}
      {list.isError && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
          {ACTIVITY_COPY.activityFailed}
          <Button size="sm" variant="secondary" onClick={list.refetch}>
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
                      // The title's link covers the row, so the whole row opens the invoice.
                      title={
                        <Link
                          href={`${APP_ROUTES.invoices}/${item.invoiceId}`}
                          className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                        >
                          {deposit
                            ? item.held
                              ? ACTIVITY_COPY.held
                              : ACTIVITY_COPY.deposit
                            : ACTIVITY_COPY.invoice}
                        </Link>
                      }
                      // Phones show one network as its logo on the icon (its name stays for screen readers), so
                      // the time never gets cut; wider rows name it first.
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
          {more && limit < ACTIVITY_MAX ? (
            <Button
              variant="secondary"
              className="self-start"
              loading={list.isFetching && rows.length < limit}
              onClick={() => setLimit(Math.min(limit + ACTIVITY_PAGE_SIZE, ACTIVITY_MAX))}
            >
              {ACTIVITY_COPY.loadMore}
            </Button>
          ) : more ? (
            <p className="text-sm text-muted">{ACTIVITY_COPY.latestOnly}</p>
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
