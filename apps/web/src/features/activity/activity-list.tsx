"use client";

import {
  ACTIVITY_DIRECTIONS,
  ActivityRow,
  Button,
  SearchField,
  SegmentedControl,
  Skeleton,
} from "@forwend/ui-web";
import Link from "next/link";
import { useState } from "react";
import {
  ACTIVITY_KINDS,
  ACTIVITY_MAX,
  ACTIVITY_PAGE_SIZE,
  activityStatus,
  filterActivity,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/features/activity/activity";
import { useGetActivityQuery } from "@/features/activity/activity-api";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { chainName } from "@/shared/chains/chains";
import { ExplorerLink } from "@/shared/chains/explorer-link";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

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
// its transaction. The filter and search work on the rows loaded so far.
interface ActivityListProps {
  profileId: string;
}

// A new list per profile: the rows shown while more load are always this profile's.
export function ActivityList(props: ActivityListProps) {
  return <ProfileActivity key={props.profileId} {...props} />;
}

function ProfileActivity({ profileId }: ActivityListProps) {
  const [limit, setLimit] = useState<number>(ACTIVITY_PAGE_SIZE);
  const [filter, setFilter] = useState<StatusFilter>(STATUS_FILTERS.all);
  const [search, setSearch] = useState("");
  const list = useGetActivityQuery({ profileId, limit }, LIVE_QUERY);
  const items = list.data?.items ?? [];
  const rows = filterActivity(items, filter, search);
  const more = Boolean(list.data?.nextCursor);

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={!list.data && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 id="activity-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {ACTIVITY_COPY.activity}
      </h1>
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Phones: the search first, the filter on its own row below. */}
          <SegmentedControl
            label={ACTIVITY_COPY.filterLabel}
            className="max-sm:order-last"
            value={filter}
            onValueChange={setFilter}
            options={Object.values(STATUS_FILTERS).map((value) => ({
              value,
              label: ACTIVITY_COPY.filters[value],
            }))}
          />
          <SearchField
            label={ACTIVITY_COPY.search}
            value={search}
            onValueChange={setSearch}
            placeholder={ACTIVITY_COPY.searchPlaceholder}
            className="flex-1 max-sm:basis-full sm:max-w-72"
          />
        </div>
      ) : null}
      {list.isError && !list.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
          {ACTIVITY_COPY.activityFailed}
          <Button size="sm" variant="secondary" onClick={list.refetch}>
            {ACTIVITY_COPY.retry}
          </Button>
        </div>
      ) : !list.data ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <p className="py-2 text-muted">{ACTIVITY_COPY.emptyActivity}</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="rounded-md border border-line bg-surface px-5 py-8 text-sm text-muted">
              {ACTIVITY_COPY.noMatch}
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
              {rows.map((item, i) => {
                const deposit = item.kind === ACTIVITY_KINDS.deposit;
                return (
                  <li
                    // The same transaction can pay two invoices, and one invoice can get two payments in it.
                    // biome-ignore lint/suspicious/noArrayIndexKey: the position completes the key
                    key={`${item.kind}:${item.invoiceId}:${item.txHash ?? ""}:${i}`}
                    className="relative px-4 hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]"
                  >
                    <ActivityRow
                      // The title's link covers the row, so the whole row opens the invoice.
                      title={
                        <Link
                          href={`${APP_ROUTES.invoices}/${item.invoiceId}`}
                          className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                        >
                          {deposit ? ACTIVITY_COPY.deposit : ACTIVITY_COPY.invoice}
                        </Link>
                      }
                      detail={`${TIME.format(new Date(item.at))} · ${chainName(item.chainId)}`}
                      direction={
                        deposit ? ACTIVITY_DIRECTIONS.incoming : ACTIVITY_DIRECTIONS.request
                      }
                      amount={{
                        baseUnits: BigInt(item.amount),
                        decimals: item.decimals,
                        token: item.symbol,
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
              loading={list.isFetching && items.length < limit}
              onClick={() => setLimit(Math.min(limit + ACTIVITY_PAGE_SIZE, ACTIVITY_MAX))}
            >
              {ACTIVITY_COPY.loadMore}
            </Button>
          ) : more ? (
            <p className="text-sm text-muted">{ACTIVITY_COPY.latestOnly}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
