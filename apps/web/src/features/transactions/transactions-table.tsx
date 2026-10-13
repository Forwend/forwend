"use client";

import {
  Button,
  buttonClasses,
  Money,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  SearchField,
  SegmentedControl,
  StatusPill,
  shortAddress,
} from "@forwend/ui-web";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
  TRANSACTION_DIRECTIONS,
  TRANSACTION_FILTERS,
  TRANSACTIONS_MAX,
  TRANSACTIONS_PAGE_SIZE,
  type Transaction,
  transactionKey,
  transactionStatus,
  transactionsCsv,
} from "@/features/transactions/transactions";
import { useGetTransactionsQuery } from "@/features/transactions/transactions-api";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { addressLink } from "@/shared/chains/chains";
import { ExplorerLink } from "@/shared/chains/explorer-link";
import { NetworkName } from "@/shared/chains/network-name";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { useListFilters, useShownData } from "@/shared/hooks/use-list-filters";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
  const filtered = !preview && filters.filtered;
  const more = Boolean(data?.nextCursor);
  const Heading = pageHeading ? "h1" : "h2";
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
      className={
        pageHeading
          ? "flex flex-col gap-4"
          : "flex flex-col rounded-md border border-line bg-surface"
      }
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${pageHeading ? "" : "border-b border-line px-4 py-3 sm:px-5"}`}
      >
        {/* As the page's heading, the header's breadcrumb names it on desktop, so it shows only on phones. */}
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
        {preview ? (
          rows.length > 0 ? (
            <Link
              href={APP_ROUTES.transactions}
              className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink"
            >
              {TRANSACTIONS_COPY.viewAll}
              <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
            </Link>
          ) : null
        ) : (
          <div
            className={`flex flex-wrap items-center gap-2 ${pageHeading ? "w-full lg:w-auto lg:flex-1" : "w-full sm:w-auto"}`}
          >
            <SegmentedControl
              label={TRANSACTIONS_COPY.filterLabel}
              value={filters.filter}
              onValueChange={filters.setFilter}
              options={Object.values(TRANSACTION_FILTERS).map((value) => ({
                value,
                label: TRANSACTIONS_COPY.filters[value],
              }))}
            />
            <SearchField
              label={TRANSACTIONS_COPY.search}
              value={filters.search}
              onValueChange={filters.setSearch}
              placeholder={TRANSACTIONS_COPY.searchPlaceholder}
              className="flex-1 sm:w-64 sm:flex-none max-sm:order-last max-sm:basis-full"
            />
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} ml-auto`}
            >
              <Download aria-hidden className="size-[var(--fw-icon-sm)]" />
              {TRANSACTIONS_COPY.exportCsv}
            </button>
          </div>
        )}
      </div>

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
        <RowsSkeleton
          count={skeletonRows}
          className={pageHeading ? "rounded-md border border-line bg-surface" : ""}
        />
      ) : rows.length === 0 && !filtered ? (
        <p className="px-5 py-8 text-sm text-muted">{TRANSACTIONS_COPY.empty}</p>
      ) : rows.length === 0 ? (
        <NoMatch
          text={TRANSACTIONS_COPY.noMatch}
          onClear={filters.clear}
          className={pageHeading ? "rounded-md border border-line bg-surface" : ""}
        />
      ) : (
        <div className={pageHeading ? "rounded-md border border-line bg-surface" : ""}>
          {/* Wide screens: a ruled table, scrolled sideways rather than squeezed when its column is narrow. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    {TRANSACTIONS_COPY.columns.transaction}
                  </th>
                  <th scope="col" className="hidden px-3 py-2.5 font-medium 2xl:table-cell">
                    {TRANSACTIONS_COPY.columns.network}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {TRANSACTIONS_COPY.columns.date}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {TRANSACTIONS_COPY.columns.status}
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    {TRANSACTIONS_COPY.columns.amount}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => (
                  <tr key={transactionKey(t)}>
                    <td className="px-5 py-3">
                      {/* Below 2xl the network moves under the counterparty, so no amount lacks it. */}
                      <Party
                        t={t}
                        detail={<NetworkName chainId={t.chainId} />}
                        detailClassName="2xl:hidden"
                      />
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap text-muted 2xl:table-cell">
                      <NetworkName chainId={t.chainId} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">
                      <span className="inline-flex items-center gap-1">
                        <time dateTime={t.at}>{DATE.format(new Date(t.at))}</time>
                        <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Status t={t} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Amount t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {rows.map((t) => (
              <li key={transactionKey(t)} className="flex items-center gap-3 px-4 py-3">
                {/* The network first: a narrow row cuts the time, never the network. */}
                <Party
                  t={t}
                  short
                  detail={
                    <>
                      {/* The network never shrinks; the time is what a narrow row cuts. */}
                      <span className="shrink-0">
                        <NetworkName chainId={t.chainId} />
                      </span>
                      <span className="truncate">· {DATE.format(new Date(t.at))}</span>
                    </>
                  }
                />
                <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <Amount t={t} />
                  <span className="flex items-center gap-1">
                    <ExplorerLink chainId={t.chainId} txHash={t.txHash} />
                    <span className="text-xs">
                      <Status t={t} />
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
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
    </section>
  );
}

function Party({
  t,
  detail,
  detailClassName = "",
  short = false,
}: {
  t: Transaction;
  detail?: ReactNode;
  detailClassName?: string;
  short?: boolean;
}) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const zero = t.counterparty.toLowerCase() === ZERO_ADDRESS;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-pill ${incoming ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
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
    <span className="text-muted">{PAYMENT_STATUSES[status].label}</span>
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
