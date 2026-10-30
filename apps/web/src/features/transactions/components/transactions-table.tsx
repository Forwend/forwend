"use client";

import {
  Button,
  buttonClasses,
  EmptyState,
  Money,
  PAYMENT_STATUS,
  SearchField,
  SegmentedControl,
  StatusPill,
  shortAddress,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import {
  useGetTransactionPagesInfiniteQuery,
  useGetTransactionsQuery,
} from "@/features/transactions/api/transactions-api";
import { ExportTransactions } from "@/features/transactions/components/export-transactions";
import { RecordsValue } from "@/features/transactions/components/records-value";
import { TransactionType } from "@/features/transactions/components/transaction-type";
import {
  RELATIVE_DAYS,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_FILTERS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import {
  type DayGroup,
  groupByDay,
  transactionKey,
  transactionStatus,
} from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { ChainBadge, hasChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { addressLink, chainName } from "@/shared/lib/chains";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const DAY_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const dayName = (when: DayGroup<Transaction>["when"]) =>
  when === RELATIVE_DAYS.today
    ? TRANSACTIONS_COPY.today
    : when === RELATIVE_DAYS.yesterday
      ? TRANSACTIONS_COPY.yesterday
      : (when.getFullYear() === new Date().getFullYear() ? DAY : DAY_WITH_YEAR).format(when);
const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const SHORT_DAY_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const shortDay = (when: DayGroup<Transaction>["when"]) =>
  when === RELATIVE_DAYS.today || when === RELATIVE_DAYS.yesterday
    ? dayName(when)
    : (when.getFullYear() === new Date().getFullYear() ? SHORT_DAY : SHORT_DAY_WITH_YEAR).format(
        when,
      );

interface TransactionsTableProps {
  profileId: string;
  title: string;
  pageHeading?: boolean;
  /** One quiet line under the page's heading: what the list holds. */
  intro?: string;
  preview?: number;
}

// A new table per profile: rows shown while more load are always this profile's.
export function TransactionsTable(props: TransactionsTableProps) {
  return <ProfileTransactions key={props.profileId} {...props} />;
}

// A preview reads one short page; the full list pages by cursor and stays live while it shows its first page.
function ProfileTransactions({
  profileId,
  title,
  pageHeading,
  intro,
  preview,
}: TransactionsTableProps) {
  const filters = useListFilters(
    "direction",
    Object.values(TRANSACTION_FILTERS),
    TRANSACTION_FILTERS.all,
  );
  const [pages, setPages] = useState(1);
  const recent = useGetTransactionsQuery(
    preview ? { profileId, limit: preview } : skipToken,
    LIVE_QUERY,
  );
  const paged = useGetTransactionPagesInfiniteQuery(
    preview ? skipToken : { profileId, direction: filters.apiFilter, q: filters.apiQuery },
    { ...LIVE_QUERY, pollingInterval: pages > 1 ? 0 : LIVE_QUERY.pollingInterval },
  );
  const list = preview ? recent : paged;
  const pagedData = useShownData(filters.key, paged.currentData, paged.data);
  if ((pagedData?.pages.length ?? 1) !== pages) setPages(pagedData?.pages.length ?? 1);
  const data = preview
    ? recent.data
    : pagedData && { items: pagedData.pages.flatMap((page) => page.items) };
  const rows = data?.items ?? [];
  const days = groupByDay(rows, new Date());
  const dayId = useId();
  const filtered = !preview && filters.filtered;
  // A profile with no transactions at all: search, the filter and Export have nothing to act on, so the page is the
  // empty state alone, as on Invoices and Payment links.
  const none = pageHeading && Boolean(data) && rows.length === 0 && !filtered;
  const stale = !preview && !paged.currentData && Boolean(pagedData);
  const Heading = pageHeading ? "h1" : "h2";
  const DayHeading = pageHeading ? "h2" : "h3";
  // A new filter or search loads in place of as many rows as were shown.
  const [skeletonRows, setSkeletonRows] = useState(preview ?? SKELETON_ROWS);
  if (rows.length > 0 && rows.length !== skeletonRows) setSkeletonRows(rows.length);

  return (
    <section
      aria-labelledby={`${profileId}-transactions`}
      aria-busy={(!data && !list.isError) || stale || undefined}
      className={pageHeading ? "flex flex-col gap-4" : "fw-panel flex flex-col"}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${pageHeading ? "lg:contents" : "fw-panel-head"}`}
      >
        {/* As the page's heading, the header's breadcrumb names it on desktop, so it shows only below that. */}
        <Heading
          id={`${profileId}-transactions`}
          className={
            pageHeading
              ? "text-2xl font-semibold tracking-tight text-ink lg:sr-only"
              : "text-base font-semibold text-ink"
          }
        >
          {title}
        </Heading>
        {preview && rows.length > 0 ? (
          <Link
            href={APP_ROUTES.transactions}
            className={`${buttonClasses({ variant: "ghost", size: "sm" })} -mr-2`}
          >
            {TRANSACTIONS_COPY.viewAll}
            <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
          </Link>
        ) : null}
      </div>
      {intro && !none ? <p className="-mt-2 text-sm text-muted lg:mt-0">{intro}</p> : null}
      {preview || none ? null : (
        <ListToolbar
          search={
            <SearchField
              label={TRANSACTIONS_COPY.search}
              value={filters.search}
              onValueChange={filters.setSearch}
              placeholder={TRANSACTIONS_COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          filter={
            <SegmentedControl
              label={TRANSACTIONS_COPY.filterLabel}
              value={filters.filter}
              onValueChange={filters.setFilter}
              className="max-sm:min-w-56 max-sm:flex-1"
              options={Object.values(TRANSACTION_FILTERS).map((value) => ({
                value,
                label: TRANSACTIONS_COPY.filters[value],
              }))}
            />
          }
          // The export ignores the direction and search, so only a profile with no transactions has nothing to export.
          actions={
            <ExportTransactions profileId={profileId} disabled={!filtered && rows.length === 0} />
          }
        />
      )}

      {list.isError && !data ? (
        <div className={pageHeading ? undefined : "px-4 pb-4 sm:px-5"}>
          <LoadError
            message={TRANSACTIONS_COPY.failed}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        </div>
      ) : !data ? (
        <RowsSkeleton count={skeletonRows} className={pageHeading ? "fw-panel" : ""} />
      ) : rows.length === 0 && !filtered ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={TRANSACTIONS_COPY.emptyTitle}
          description={TRANSACTIONS_COPY.emptyText}
          // An overview card has its own frame.
          compact={!pageHeading}
          page={pageHeading}
        />
      ) : rows.length === 0 ? (
        <NoMatch onClear={filters.clear} compact={!pageHeading} page={pageHeading} />
      ) : (
        // Columns show by the list's own width, as on every record table, so a collapsed sidebar shows more.
        <div
          className={`@container ${pageHeading ? "fw-panel overflow-hidden" : ""} ${stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : ""}`}
        >
          <table className="hidden w-full text-sm @3xl:table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className={TABLE_HEAD_CLASSES}>
                <th scope="col" className="w-1/3">
                  {TRANSACTIONS_COPY.columns.transaction}
                </th>
                {preview ? null : <th scope="col">{TRANSACTIONS_COPY.columns.type}</th>}
                <th scope="col" className="hidden @5xl:table-cell">
                  {TRANSACTIONS_COPY.columns.network}
                </th>
                <th scope="col">{TRANSACTIONS_COPY.columns.date}</th>
                <th scope="col">{TRANSACTIONS_COPY.columns.status}</th>
                <th scope="col" className="text-right">
                  {TRANSACTIONS_COPY.columns.amount}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.map((group) =>
                group.items.map((t) => (
                  <tr
                    key={transactionKey(t)}
                    className={`transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]`}
                  >
                    <td className="max-w-0">
                      <Party t={t} badgeClassName="@5xl:hidden" />
                    </td>
                    {preview ? null : (
                      // A compact select keeps the row on one line; touch keeps the full-size target.
                      <td className="whitespace-nowrap pointer-fine:[&_[role=combobox]]:h-8">
                        <TransactionType profileId={profileId} t={t} />
                      </td>
                    )}
                    <td className="hidden whitespace-nowrap text-muted @5xl:table-cell">
                      <NetworkName chainId={t.chainId} />
                    </td>
                    <td className="whitespace-nowrap text-muted tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <time dateTime={t.at}>
                          {shortDay(group.when)}, {TIME.format(new Date(t.at))}
                        </time>
                        <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <Status t={t} />
                    </td>
                    <td className="text-right">
                      <Amount t={t} />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <div className="@3xl:hidden">
            {days.map((group) => (
              <section key={group.day} aria-labelledby={`${dayId}-${group.day}`}>
                <DayHeading
                  id={`${dayId}-${group.day}`}
                  className="border-b border-line px-4 pt-4 pb-1.5 text-xs font-medium text-muted sm:px-5"
                >
                  {dayName(group.when)}
                </DayHeading>
                <ul className="divide-y divide-line">
                  {group.items.map((t) => (
                    <li key={transactionKey(t)} className="min-h-15 px-4 py-2.5 sm:px-5">
                      <div className="flex items-center gap-3">
                        <Party
                          t={t}
                          short
                          detail={
                            <>
                              <time dateTime={t.at} className="whitespace-nowrap">
                                {TIME.format(new Date(t.at))}
                              </time>
                              {hasChainBadge(t.chainId) ? null : ` · ${chainName(t.chainId)}`}
                              <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
                            </>
                          }
                        />
                        <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                          <Amount t={t} />
                          {transactionStatus(t) === PAYMENT_STATUS.confirmed ? null : (
                            <span className="text-xs">
                              <Status t={t} />
                            </span>
                          )}
                        </span>
                      </div>
                      {preview ? null : (
                        <div className="mt-1.5 pl-12 text-sm">
                          <TransactionType profileId={profileId} t={t} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {!preview && paged.hasNextPage ? (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <Button
                variant="secondary"
                size="sm"
                loading={paged.isFetchingNextPage}
                onClick={() => void paged.fetchNextPage()}
              >
                {TRANSACTIONS_COPY.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {list.error && data ? (
        <div className={pageHeading ? undefined : "px-4 pb-4 sm:px-5"}>
          <LoadError
            inline
            message={TRANSACTIONS_COPY.updateFailed}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        </div>
      ) : null}
    </section>
  );
}

// One line in the table, where the network is a column or, without room, the logo on the icon; phones add a detail line.
function Party({
  t,
  detail,
  short = false,
  badgeClassName = "",
}: {
  t: Transaction;
  detail?: ReactNode;
  short?: boolean;
  badgeClassName?: string;
}) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const zero = t.counterparty.toLowerCase() === ZERO_ADDRESS;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={`relative grid shrink-0 place-items-center rounded-pill ${detail ? "size-9" : "size-7"} ${incoming ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
        <ChainBadge chainId={t.chainId} className={badgeClassName} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">
          {zero
            ? incoming
              ? TRANSACTIONS_COPY.minted
              : TRANSACTIONS_COPY.burned
            : incoming
              ? short
                ? TRANSACTIONS_COPY.from
                : TRANSACTIONS_COPY.receivedFrom
              : short
                ? TRANSACTIONS_COPY.to
                : TRANSACTIONS_COPY.sentTo}
          {zero ? null : (
            <>
              {" "}
              <Counterparty t={t} />
            </>
          )}
          {hasChainBadge(t.chainId) ? (
            <span className={`sr-only ${badgeClassName}`}>, {chainName(t.chainId)}</span>
          ) : null}
        </span>
        {detail ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted">{detail}</span>
        ) : null}
      </span>
    </span>
  );
}

function Counterparty({ t }: { t: Transaction }) {
  const link = addressLink(t.chainId, t.counterparty);
  const short = shortAddress(t.counterparty);
  return link ? (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      title={t.counterparty}
      aria-label={TRANSACTIONS_COPY.counterpartyLink(short, link.name)}
      className="rounded-sm font-mono font-normal text-muted underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus"
    >
      {short}
    </a>
  ) : (
    <span className="font-mono font-normal text-muted" title={t.counterparty}>
      {short}
    </span>
  );
}

function Status({ t }: { t: Transaction }) {
  return <StatusPill quiet status={transactionStatus(t)} />;
}

function Amount({ t }: { t: Transaction }) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={`whitespace-nowrap ${incoming ? "text-success" : "text-ink"}`}>
        {incoming ? "+" : "−"}
        <Money
          baseUnits={BigInt(t.amount)}
          decimals={t.decimals}
          token={t.symbol}
          className="flex-nowrap"
        />
      </span>
      {t.recordsValue ? <RecordsValue value={t.recordsValue} /> : null}
    </span>
  );
}
