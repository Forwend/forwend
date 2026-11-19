"use client";

import { Button, buttonClasses, EmptyState, SearchField, SegmentedControl } from "@forwend/ui-web";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { ExportTransactions } from "@/features/transactions/components/export-transactions";
import { TransactionPhoneRow } from "@/features/transactions/components/transaction-phone-row";
import { TransactionSheet } from "@/features/transactions/components/transaction-sheet";
import { TransactionsDesktopTable } from "@/features/transactions/components/transactions-desktop-table";
import { TransactionsSkeleton } from "@/features/transactions/components/transactions-skeleton";
import { TRANSACTION_FILTERS } from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { useTransactionRows } from "@/features/transactions/hooks/use-transaction-rows";
import { groupByDay, transactionKey } from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";
import { dayName } from "@/shared/lib/dates";

interface TransactionsTableProps {
  profileId: string;
  title: string;
  /** One quiet line under the page's heading: what the list holds. */
  intro?: string;
  /** The overview's card of this many rows, instead of the Transactions page. */
  preview?: number;
  /** The empty page's next step, such as Receive. */
  emptyAction?: ReactNode;
}

// A new table per profile: rows shown while more load are always this profile's.
export function TransactionsTable(props: TransactionsTableProps) {
  return <ProfileTransactions key={props.profileId} {...props} />;
}

function ProfileTransactions({
  profileId,
  title,
  intro,
  preview,
  emptyAction,
}: TransactionsTableProps) {
  const { filters, list, paged, data, rows, stale } = useTransactionRows(profileId, preview);
  const page = !preview;
  const days = groupByDay(rows);
  const dayId = useId();
  const filtered = page && filters.filtered;
  // A profile with no transactions at all: search, the filter and Export have nothing to act on, so the page is the
  // empty state alone, as on Invoices and Payment links.
  const none = page && Boolean(data) && rows.length === 0 && !filtered;
  const Heading = page ? "h1" : "h2";
  const DayHeading = page ? "h2" : "h3";
  // A new filter or search loads in place of as many rows as were shown.
  const [skeletonRows, setSkeletonRows] = useState(preview ?? SKELETON_ROWS);
  if (rows.length > 0 && rows.length !== skeletonRows) setSkeletonRows(rows.length);
  // A phone row opens a sheet. It reads the live row, so a status or a saved type shows at once; the last snapshot
  // stands in once the row has left the list (a Sending row handing over) and while the sheet closes.
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Transaction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const opened = rows.find((r) => transactionKey(r) === openedKey) ?? snapshot;
  const searched = [
    filters.apiQuery ? TRANSACTIONS_COPY.searched(filters.apiQuery) : null,
    filters.filter === TRANSACTION_FILTERS.all
      ? null
      : TRANSACTIONS_COPY.direction(TRANSACTIONS_COPY.filters[filters.filter]),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      aria-labelledby={`${profileId}-transactions`}
      aria-busy={(!data && !list.isError) || stale || undefined}
      className={page ? "flex flex-col gap-4" : "fw-panel flex flex-col"}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${page ? "lg:contents" : "fw-panel-head"}`}
      >
        {/* As the page's heading, the header's breadcrumb names it on desktop, so it shows only below that. */}
        <Heading
          id={`${profileId}-transactions`}
          className={
            page
              ? "text-2xl font-semibold tracking-tight text-ink lg:sr-only"
              : "text-base font-semibold text-ink"
          }
        >
          {title}
        </Heading>
        {/* On a phone the title row carries Export, as on Payments. */}
        {page && !none ? (
          <div className="sm:hidden">
            <ExportTransactions profileId={profileId} disabled={!filtered && rows.length === 0} />
          </div>
        ) : null}
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
          wideFilter
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
              className="max-sm:w-full"
              options={Object.values(TRANSACTION_FILTERS).map((value) => ({
                value,
                label: TRANSACTIONS_COPY.filters[value],
              }))}
            />
          }
          // The export ignores the direction and search, so only a profile with no transactions has nothing to export.
          actions={
            <div className="max-sm:hidden">
              <ExportTransactions profileId={profileId} disabled={!filtered && rows.length === 0} />
            </div>
          }
        />
      )}

      {list.isError && !data ? (
        <div className={page ? undefined : "px-4 pb-4 sm:px-5"}>
          <LoadError
            message={TRANSACTIONS_COPY.failed}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        </div>
      ) : !data ? (
        <TransactionsSkeleton count={skeletonRows} preview={!page} />
      ) : rows.length === 0 && !filtered ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={TRANSACTIONS_COPY.emptyTitle}
          description={TRANSACTIONS_COPY.emptyText}
          // An overview card has its own frame.
          compact={!page}
          page={page}
          action={emptyAction}
        />
      ) : rows.length === 0 ? (
        <NoMatch
          onClear={filters.clear}
          compact={!page}
          page={page}
          title={TRANSACTIONS_COPY.noMatchTitle}
          description={searched ? `${searched[0]?.toUpperCase()}${searched.slice(1)}.` : undefined}
        />
      ) : (
        // Columns show by the list's own width, as on every record table, so a collapsed sidebar shows more.
        <div
          className={`@container ${page ? "fw-panel overflow-hidden" : ""} ${stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : ""}`}
        >
          <TransactionsDesktopTable
            profileId={profileId}
            title={title}
            preview={!page}
            rows={rows}
          />
          <div className="@3xl:hidden">
            {days.map((group) => (
              <section key={group.day} aria-labelledby={`${dayId}-${group.day}`}>
                <DayHeading
                  id={`${dayId}-${group.day}`}
                  className="border-b border-line px-4 pt-4 pb-1.5 text-xs font-medium text-muted sm:px-5"
                >
                  {dayName(group.at)}
                </DayHeading>
                <ul className="divide-y divide-line">
                  {group.items.map((t) => (
                    <li key={transactionKey(t)}>
                      <TransactionPhoneRow
                        t={t}
                        typed={page}
                        onOpen={() => {
                          setOpenedKey(transactionKey(t));
                          setSnapshot(t);
                          setSheetOpen(true);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {page && paged.hasNextPage ? (
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
      <TransactionSheet
        profileId={profileId}
        t={opened}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
      {list.error && data ? (
        <div className={page ? undefined : "px-4 pb-4 sm:px-5"}>
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
