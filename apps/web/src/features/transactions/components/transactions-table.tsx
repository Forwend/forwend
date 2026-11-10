"use client";

import {
  Button,
  buttonClasses,
  EmptyState,
  Money,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatusPill,
  shortAddress,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useListPendingSendsQuery } from "@/features/send/api/send-api";
import {
  useGetTransactionPagesInfiniteQuery,
  useGetTransactionsQuery,
} from "@/features/transactions/api/transactions-api";
import { Counterparty } from "@/features/transactions/components/counterparty";
import { ExportTransactions } from "@/features/transactions/components/export-transactions";
import { RecordsValue } from "@/features/transactions/components/records-value";
import { SignedAmount } from "@/features/transactions/components/signed-amount";
import { TransactionSheet } from "@/features/transactions/components/transaction-sheet";
import { TransactionType } from "@/features/transactions/components/transaction-type";
import {
  TRANSACTION_CLASSES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_FILTERS,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import {
  groupByDay,
  sendingRows,
  transactionFee,
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
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";
import { dayName, dayTime, timeOfDay } from "@/shared/lib/dates";
import { exactDigits } from "@/shared/lib/money";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const SENDING_POLL_MS = 3000;
interface TransactionsTableProps {
  profileId: string;
  title: string;
  pageHeading?: boolean;
  /** One quiet line under the page's heading: what the list holds. */
  intro?: string;
  preview?: number;
  /** The empty page's next step, such as Receive. */
  emptyAction?: ReactNode;
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
  emptyAction,
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
  // R-215: signed sends come first as Sending until the watcher records them. A search or Received only hides them.
  const showsSends =
    Boolean(preview) || (!filters.apiQuery && filters.apiFilter !== TRANSACTION_DIRECTIONS.in);
  const [waiting, setWaiting] = useState(false);
  const pending = useListPendingSendsQuery(showsSends ? profileId : skipToken, {
    ...LIVE_QUERY,
    // About a block while one waits, so its row hands over to the recorded transfer soon after.
    pollingInterval: waiting ? SENDING_POLL_MS : LIVE_QUERY.pollingInterval,
  });
  const recorded = data?.items ?? [];
  const sending = sendingRows(pending.currentData?.sends ?? [], recorded);
  // A send that leaves the pending list has its own row now: read the list again rather than wait for its poll.
  const sendingCount = useRef(sending.length);
  const { refetch } = list;
  useEffect(() => {
    if (sending.length < sendingCount.current) void refetch();
    sendingCount.current = sending.length;
  }, [sending.length, refetch]);
  if (waiting !== sending.length > 0) setWaiting(sending.length > 0);
  // A preview keeps its size: Sending rows come first and push the oldest out.
  const rows = [...sending, ...recorded].slice(0, preview);
  const days = groupByDay(rows);
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
        {/* On a phone the title row carries Export, as on Payments. */}
        {pageHeading && !none ? (
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
        <div className={pageHeading ? undefined : "px-4 pb-4 sm:px-5"}>
          <LoadError
            message={TRANSACTIONS_COPY.failed}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        </div>
      ) : !data ? (
        <TableSkeleton count={skeletonRows} preview={Boolean(preview)} framed={pageHeading} />
      ) : rows.length === 0 && !filtered ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={TRANSACTIONS_COPY.emptyTitle}
          description={TRANSACTIONS_COPY.emptyText}
          // An overview card has its own frame.
          compact={!pageHeading}
          page={pageHeading}
          action={pageHeading ? emptyAction : undefined}
        />
      ) : rows.length === 0 ? (
        <NoMatch
          onClear={filters.clear}
          compact={!pageHeading}
          page={pageHeading}
          title={TRANSACTIONS_COPY.noMatchTitle}
          description={searched ? `${searched[0]?.toUpperCase()}${searched.slice(1)}.` : undefined}
        />
      ) : (
        // Columns show by the list's own width, as on every record table, so a collapsed sidebar shows more.
        <div
          className={`@container ${pageHeading ? "fw-panel overflow-hidden" : ""} ${stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : ""}`}
        >
          <table className="hidden w-full text-sm @3xl:table">
            <caption className="sr-only">{title}</caption>
            <TableHead preview={Boolean(preview)} />
            <tbody className="divide-y divide-line">
              {days.map((group) =>
                group.items.map((t) => (
                  <tr
                    key={transactionKey(t)}
                    className={`transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]`}
                  >
                    <td className="max-w-0">
                      <Party t={t} />
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
                        <time dateTime={t.at}>{dayTime(t.at)}</time>
                        <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusPill quiet status={transactionStatus(t)} />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <Fee t={t} />
                    </td>
                    <td className="text-right">
                      <span className="inline-flex flex-col items-end">
                        <SignedAmount t={t} />
                        {t.recordsValue ? <RecordsValue value={t.recordsValue} /> : null}
                      </span>
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
                  {dayName(group.at)}
                </DayHeading>
                <ul className="divide-y divide-line">
                  {group.items.map((t) => (
                    <li key={transactionKey(t)}>
                      <PhoneRow
                        t={t}
                        typed={!preview}
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
      <TransactionSheet
        profileId={profileId}
        t={opened}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
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

/** The table's head, shared with its loading form so the real headers stay while rows load. */
function TableHead({ preview }: { preview: boolean }) {
  const c = TRANSACTIONS_COPY.columns;
  return (
    <thead>
      <tr className={TABLE_HEAD_CLASSES}>
        <th scope="col" className="w-1/3">
          {c.transaction}
        </th>
        {preview ? null : <th scope="col">{c.type}</th>}
        <th scope="col" className="hidden @5xl:table-cell">
          {c.network}
        </th>
        <th scope="col">{c.date}</th>
        <th scope="col">{c.status}</th>
        <th scope="col" className="text-right">
          {c.fee}
        </th>
        <th scope="col" className="text-right">
          {c.amount}
        </th>
      </tr>
    </thead>
  );
}

// One line in the table, where the network is a column or, without room, the logo on the icon.
function Party({ t }: { t: Transaction }) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const zero = t.counterparty.toLowerCase() === ZERO_ADDRESS;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <DirectionIcon t={t} badgeClassName="@5xl:hidden" />
      <span className="block min-w-0 truncate font-medium text-ink">
        {zero
          ? incoming
            ? TRANSACTIONS_COPY.minted
            : TRANSACTIONS_COPY.burned
          : incoming
            ? TRANSACTIONS_COPY.from
            : TRANSACTIONS_COPY.to}
        {zero ? null : (
          <>
            {" "}
            <Counterparty t={t} />
          </>
        )}
        {hasChainBadge(t.chainId) ? (
          <span className="sr-only @5xl:hidden">, {chainName(t.chainId)}</span>
        ) : null}
      </span>
    </span>
  );
}

/** The round icon that leads a row: the direction, with the network's logo on its corner. */
function DirectionIcon({
  t,
  badgeClassName = "",
  large = false,
}: {
  t: Transaction;
  badgeClassName?: string;
  large?: boolean;
}) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-pill ${large ? "size-9" : "size-7"} ${incoming ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
    >
      <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      <ChainBadge chainId={t.chainId} className={badgeClassName} />
    </span>
  );
}

/** Never part of the amount: taken before money arrived, or paid on top of money sent. A dash where none was recorded. */
function Fee({ t }: { t: Transaction }) {
  const fee = transactionFee(t);
  if (fee === null)
    return (
      <span className="text-subtle">
        <span aria-hidden>—</span>
        <span className="sr-only">{TRANSACTIONS_COPY.noFeeRecorded}</span>
      </span>
    );
  if (fee === 0n) return <span className="text-muted">{TRANSACTIONS_COPY.noFee}</span>;
  return (
    <Money
      baseUnits={fee}
      decimals={t.decimals}
      token={t.symbol}
      fractionDigits={exactDigits(fee, t.decimals)}
      nowrap
      className="text-ink"
    />
  );
}

/** The phone row's title: the invoice and client it paid, else the other side's address. */
function rowTitle(t: Transaction): ReactNode {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  if (t.counterparty.toLowerCase() === ZERO_ADDRESS)
    return incoming ? TRANSACTIONS_COPY.minted : TRANSACTIONS_COPY.burned;
  if (t.invoice && !t.labelable)
    return TRANSACTIONS_COPY.invoicePaid(invoiceNumber(t.invoice.number), t.invoice.clientName);
  const lead =
    t.payment && !t.labelable
      ? TRANSACTIONS_COPY.paymentFrom
      : !incoming && t.classification === TRANSACTION_CLASSES.ownTransfer
        ? TRANSACTIONS_COPY.ownTransferTo
        : incoming
          ? TRANSACTIONS_COPY.from
          : TRANSACTIONS_COPY.to;
  return (
    <>
      {lead}{" "}
      <span className="font-mono font-normal text-muted">{shortAddress(t.counterparty)}</span>
    </>
  );
}

/** Two lines a row: what it was and its amount, then its status and time. A tap opens the rest, the fee too. */
function PhoneRow({
  t,
  typed,
  onOpen,
}: {
  t: Transaction;
  /** The overview's preview names no type (R-109). */
  typed: boolean;
  onOpen: () => void;
}) {
  const status = transactionStatus(t);
  const untyped =
    typed &&
    t.labelable &&
    (t.classification === TRANSACTION_CLASSES.unclassified ||
      t.classification === TRANSACTION_CLASSES.paymentException);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
    >
      <span className="mt-0.5">
        <DirectionIcon t={t} large />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-h-5.5 min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-ink">{rowTitle(t)}</span>
          <SignedAmount t={t} className="ml-auto shrink-0 font-semibold" />
        </span>
        <span className="flex min-h-5 min-w-0 items-center gap-1.5 truncate text-xs text-muted">
          {status === PAYMENT_STATUS.confirmed ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-success" />
          ) : (
            <LoaderCircle
              aria-hidden
              className="size-3 shrink-0 animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]"
            />
          )}
          <span className={status === PAYMENT_STATUS.confirmed ? "" : "font-medium text-ink"}>
            {PAYMENT_STATUSES[status].label}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={t.at} className="whitespace-nowrap">
            {timeOfDay(t.at)}
          </time>
          {hasChainBadge(t.chainId) ? (
            <span className="sr-only">, {chainName(t.chainId)}</span>
          ) : (
            <span>· {chainName(t.chainId)}</span>
          )}
        </span>
        {untyped ? (
          <span className="mt-1.5 inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2.5 text-xs font-medium text-ink shadow-[inset_0_0_0_1px_var(--fw-line-strong)]">
            <Tag aria-hidden className="size-3.5" />
            {TRANSACTIONS_COPY.setType}
            <ChevronDown aria-hidden className="size-3.5 text-muted" />
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** The loading form: the real headers, each cell its own shape; on phones, rows of the real rows' two lines. */
function TableSkeleton({
  count,
  preview,
  framed,
}: {
  count: number;
  preview: boolean;
  framed?: boolean;
}) {
  const rows = Array.from({ length: count }, (_, i) => i);
  return (
    <div aria-hidden className={`@container overflow-hidden ${framed ? "fw-panel" : ""}`}>
      <table className="hidden w-full text-sm @3xl:table">
        <TableHead preview={preview} />
        <tbody className="divide-y divide-line">
          {rows.map((i) => (
            <tr key={i} className={TABLE_ROW_CLASSES}>
              <td>
                <span className="flex items-center gap-3">
                  <Skeleton className="size-7 shrink-0 rounded-pill" />
                  <Skeleton className={`h-3 ${i % 2 ? "w-26" : "w-31"}`} />
                </span>
              </td>
              {preview ? null : (
                <td>
                  <Skeleton className={`h-3 ${i % 2 ? "w-16" : "w-29"}`} />
                </td>
              )}
              <td className="hidden @5xl:table-cell">
                <Skeleton className="h-3 w-16" />
              </td>
              <td>
                <Skeleton className="h-3 w-27" />
              </td>
              <td>
                <span className="flex items-center gap-1.5 px-2.5">
                  <Skeleton className="size-1.5 rounded-pill" />
                  <Skeleton className="h-2.5 w-14" />
                </span>
              </td>
              <td>
                <Skeleton className="ml-auto h-3 w-18" />
              </td>
              <td>
                <Skeleton className="ml-auto h-3 w-22" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="@3xl:hidden">
        <p className="border-b border-line px-4 pt-4 pb-1.5 sm:px-5">
          <Skeleton className="h-2.5 w-16" />
        </p>
        <ul className="divide-y divide-line">
          {rows.map((i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <Skeleton className="mt-0.5 size-9 shrink-0 rounded-pill" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-h-5.5 items-center justify-between gap-2">
                  <Skeleton className="h-3 w-33" />
                  <Skeleton className="h-3 w-20" />
                </span>
                <span className="flex min-h-5 items-center justify-between gap-2">
                  <Skeleton className="h-2.5 w-26" />
                  <Skeleton className="h-2.5 w-22" />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
