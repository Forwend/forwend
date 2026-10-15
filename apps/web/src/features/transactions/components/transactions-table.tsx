"use client";

import {
  Button,
  buttonClasses,
  EmptyState,
  Money,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  SearchField,
  SegmentedControl,
  StatusPill,
  shortAddress,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import {
  RELATIVE_DAYS,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_FILTERS,
  TRANSACTIONS_MAX,
  TRANSACTIONS_PAGE_SIZE,
} from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import {
  type DayGroup,
  groupByDay,
  transactionKey,
  transactionStatus,
  transactionsCsv,
} from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";
import { ChainBadge, hasChainBadge } from "@/shared/components/chains/chain-badge";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";
import { addressLink, chainName } from "@/shared/lib/chains";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
// Phone rows sit under the day they happened on, so a row shows only its time.
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
// Another year's day says its year, so last October's transfers don't read as this October's.
const dayName = (when: DayGroup<Transaction>["when"]) =>
  when === RELATIVE_DAYS.today
    ? TRANSACTIONS_COPY.today
    : when === RELATIVE_DAYS.yesterday
      ? TRANSACTIONS_COPY.yesterday
      : (when.getFullYear() === new Date().getFullYear() ? DAY : DAY_WITH_YEAR).format(when);
// The table's Date column: the same day without its weekday, the time beside it.
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
  preview?: number;
}

// A new table per profile: rows shown while more load are always this profile's.
export function TransactionsTable(props: TransactionsTableProps) {
  return <ProfileTransactions key={props.profileId} {...props} />;
}

// "Show more" asks for more rows in one request (up to the API's 100), so a refresh never skips or repeats one. The
// API applies the direction and search, kept in the URL; a preview has neither.
function ProfileTransactions({ profileId, title, pageHeading, preview }: TransactionsTableProps) {
  const [shownLimit, setShownLimit] = useState<number>(TRANSACTIONS_PAGE_SIZE);
  const filters = useListFilters(
    "direction",
    Object.values(TRANSACTION_FILTERS),
    TRANSACTION_FILTERS.all,
  );
  const limit = preview ?? shownLimit;
  const list = useGetTransactionsQuery(
    preview
      ? { profileId, limit }
      : { profileId, limit, direction: filters.apiFilter, q: filters.apiQuery },
    LIVE_QUERY,
  );
  const data = useShownData(preview ? "" : filters.key, list.currentData, list.data);
  const rows = data?.items ?? [];
  const days = groupByDay(rows, new Date());
  const dayId = useId();
  const filtered = !preview && filters.filtered;
  const more = Boolean(data?.nextCursor);
  const Heading = pageHeading ? "h1" : "h2";
  const DayHeading = pageHeading ? "h2" : "h3";
  // A new filter or search loads in place of as many rows as were shown.
  const [skeletonRows, setSkeletonRows] = useState(preview ?? SKELETON_ROWS);
  if (rows.length > 0 && rows.length !== skeletonRows) setSkeletonRows(rows.length);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([transactionsCsv(rows)], { type: "text/csv" }));
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: TRANSACTIONS_COPY.csvFile,
    });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-labelledby={`${profileId}-transactions`}
      aria-busy={!data && !list.isError}
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
      {preview ? null : (
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
              // On phones the direction takes a row of its own: too wide to sit beside the search, then all of it.
              className="max-sm:min-w-56 max-sm:flex-1"
              options={Object.values(TRANSACTION_FILTERS).map((value) => ({
                value,
                label: TRANSACTIONS_COPY.filters[value],
              }))}
            />
          }
          actions={
            // Phones keep only its icon, its touch area widened to 44px like an icon button's; the accessible name says
            // what it does.
            <Button
              variant="secondary"
              aria-label={TRANSACTIONS_COPY.exportCsv}
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="max-sm:w-10 max-sm:px-0 max-sm:pointer-coarse:before:left-1/2 max-sm:pointer-coarse:before:w-11 max-sm:pointer-coarse:before:-translate-x-1/2"
            >
              <Download aria-hidden className="size-[var(--fw-icon-sm)]" />
              <span className="max-sm:sr-only">{TRANSACTIONS_COPY.exportCsv}</span>
            </Button>
          }
        />
      )}

      {list.isError && !data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-4 px-5 py-6 text-sm text-muted"
        >
          {TRANSACTIONS_COPY.failed}
          <Button size="sm" variant="secondary" onClick={list.refetch}>
            {TRANSACTIONS_COPY.retry}
          </Button>
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
        />
      ) : rows.length === 0 ? (
        <NoMatch onClear={filters.clear} compact={!pageHeading} />
      ) : (
        <div className={pageHeading ? "fw-panel overflow-hidden" : ""}>
          {/* Wide screens: a ruled table, scrolled sideways rather than squeezed when its column is narrow. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col" className="w-[38%]">
                    {TRANSACTIONS_COPY.columns.transaction}
                  </th>
                  <th scope="col" className="hidden 2xl:table-cell">
                    {TRANSACTIONS_COPY.columns.network}
                  </th>
                  <th scope="col">{TRANSACTIONS_COPY.columns.date}</th>
                  <th scope="col">{TRANSACTIONS_COPY.columns.status}</th>
                  <th scope="col" className="text-right">
                    {TRANSACTIONS_COPY.columns.amount}
                  </th>
                </tr>
              </thead>
              {/* One ruled body: the date is a column, so no day breaks the table into bands. */}
              <tbody className="divide-y divide-line">
                {days.map((group) =>
                  group.items.map((t) => (
                    <tr
                      key={transactionKey(t)}
                      className={`transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]`}
                    >
                      <td>
                        {/* Below 2xl the network moves under the counterparty, so no amount lacks it. */}
                        <Party
                          t={t}
                          detail={<NetworkName chainId={t.chainId} />}
                          detailClassName="2xl:hidden"
                        />
                      </td>
                      <td className="hidden whitespace-nowrap text-muted 2xl:table-cell">
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
                      <td>
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
          </div>
          <div className="md:hidden">
            {days.map((group) => (
              <section key={group.day} aria-labelledby={`${dayId}-${group.day}`}>
                <DayHeading
                  id={`${dayId}-${group.day}`}
                  className="px-4 pt-4 pb-1.5 text-xs font-medium text-muted first-of-type:pt-3"
                >
                  {dayName(group.when)}
                </DayHeading>
                <ul className="divide-y divide-line">
                  {group.items.map((t) => (
                    <li
                      key={transactionKey(t)}
                      className="flex min-h-16 items-center gap-3 px-4 py-3"
                    >
                      {/* Two lines that never cut: the network rides on the icon as its logo (and in words for
                          screen readers), the time and the explorer link sit under the other side. */}
                      <Party
                        t={t}
                        short
                        chainBadge
                        detail={
                          <>
                            <time dateTime={t.at} className="whitespace-nowrap">
                              {TIME.format(new Date(t.at))}
                            </time>
                            {hasChainBadge(t.chainId) ? (
                              <span className="sr-only">, {chainName(t.chainId)}</span>
                            ) : (
                              ` · ${chainName(t.chainId)}`
                            )}
                            <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
                          </>
                        }
                      />
                      {/* A phone row names only a status that still needs waiting for, as banking apps do. */}
                      <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                        <Amount t={t} />
                        {transactionStatus(t) === PAYMENT_STATUS.confirmed ? null : (
                          <span className="text-xs">
                            <Status t={t} />
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
      {preview || !data ? null : more && limit < TRANSACTIONS_MAX ? (
        <Button
          variant="secondary"
          size="sm"
          className={pageHeading ? "self-start" : "m-4 self-start"}
          loading={list.isFetching && rows.length < limit}
          onClick={() => setShownLimit(Math.min(limit + TRANSACTIONS_PAGE_SIZE, TRANSACTIONS_MAX))}
        >
          {TRANSACTIONS_COPY.loadMore}
        </Button>
      ) : more ? (
        <p className={`text-sm text-muted ${pageHeading ? "" : "px-5 pb-4"}`}>
          {TRANSACTIONS_COPY.latestOnly}
        </p>
      ) : null}
      {list.isError && data ? (
        <div
          role="alert"
          className={`flex flex-wrap items-center gap-4 text-sm text-muted ${pageHeading ? "" : "px-5 pb-4"}`}
        >
          {TRANSACTIONS_COPY.updateFailed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {TRANSACTIONS_COPY.retry}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Party({
  t,
  detail,
  detailClassName = "",
  short = false,
  chainBadge = false,
}: {
  t: Transaction;
  detail?: ReactNode;
  detailClassName?: string;
  short?: boolean;
  /** The network's logo on the direction icon's corner, where a row has no room for its name. */
  chainBadge?: boolean;
}) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const zero = t.counterparty.toLowerCase() === ZERO_ADDRESS;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={`relative grid size-9 shrink-0 place-items-center rounded-pill ${incoming ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
        {chainBadge ? <ChainBadge chainId={t.chainId} /> : null}
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
        </span>
        {detail ? (
          <span className={`flex min-w-0 items-center gap-1 text-xs text-muted ${detailClassName}`}>
            {detail}
          </span>
        ) : null}
      </span>
    </span>
  );
}

// The other side's address, linked to its page on the chain's explorer when the chain has one.
function Counterparty({ t }: { t: Transaction }) {
  const link = addressLink(t.chainId, t.counterparty);
  const short = shortAddress(t.counterparty);
  return link ? (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      title={t.counterparty}
      aria-label={TRANSACTIONS_COPY.counterpartyLink(t.counterparty, link.name)}
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

// Confirmed is the usual end state, so only a transfer still confirming gets a pill.
function Status({ t }: { t: Transaction }) {
  const status = transactionStatus(t);
  return status === PAYMENT_STATUS.confirmed ? (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-muted">
      <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-success" />
      {PAYMENT_STATUSES[status].label}
    </span>
  ) : (
    <StatusPill status={status} />
  );
}

function Amount({ t }: { t: Transaction }) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  return (
    <span className={`whitespace-nowrap ${incoming ? "text-success" : "text-ink"}`}>
      {incoming ? "+" : "−"}
      <Money
        baseUnits={BigInt(t.amount)}
        decimals={t.decimals}
        token={t.symbol}
        className="flex-nowrap"
      />
    </span>
  );
}
