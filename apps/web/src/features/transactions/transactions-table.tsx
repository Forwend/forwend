"use client";

import {
  Button,
  buttonClasses,
  Money,
  SegmentedControl,
  Skeleton,
  StatusPill,
  shortAddress,
} from "@forwend/ui-web";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Download, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  filterTransactions,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_FILTERS,
  TRANSACTIONS_MAX,
  TRANSACTIONS_PAGE_SIZE,
  type Transaction,
  type TransactionFilter,
  transactionKey,
  transactionStatus,
  transactionsCsv,
} from "@/features/transactions/transactions";
import { useGetTransactionsQuery } from "@/features/transactions/transactions-api";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { chainName } from "@/shared/chains/chains";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

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
  initialSearch?: string;
}

// A new table per profile: rows shown while more load are always this profile's.
export function TransactionsTable(props: TransactionsTableProps) {
  return <ProfileTransactions key={props.profileId} {...props} />;
}

// "Show more" asks for more rows in one request (up to the API's 100), so a refresh never skips or repeats one.
function ProfileTransactions({
  profileId,
  title,
  pageHeading,
  preview,
  initialSearch = "",
}: TransactionsTableProps) {
  const [shownLimit, setShownLimit] = useState<number>(TRANSACTIONS_PAGE_SIZE);
  const [filter, setFilter] = useState<TransactionFilter>(TRANSACTION_FILTERS.all);
  const [search, setSearch] = useState(initialSearch);
  const limit = preview ?? shownLimit;
  const list = useGetTransactionsQuery({ profileId, limit }, LIVE_QUERY);
  const items = list.data?.items ?? [];
  const rows = preview ? items : filterTransactions(items, filter, search);
  const more = Boolean(list.data?.nextCursor);
  const Heading = pageHeading ? "h1" : "h2";

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
      aria-busy={!list.data && !list.isError}
      className={
        pageHeading
          ? "flex flex-col gap-4"
          : "flex flex-col rounded-md border border-line bg-surface"
      }
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${pageHeading ? "" : "border-b border-line px-4 py-3 sm:px-5"}`}
      >
        <Heading
          id={`${profileId}-transactions`}
          className={
            pageHeading
              ? "text-2xl font-semibold tracking-tight text-ink"
              : "text-base font-semibold text-ink"
          }
        >
          {title}
        </Heading>
        {preview ? (
          items.length > 0 ? (
            <Link
              href={APP_ROUTES.transactions}
              className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink"
            >
              {TRANSACTIONS_COPY.viewAll}
              <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
            </Link>
          ) : null
        ) : (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <SegmentedControl
              label={TRANSACTIONS_COPY.filterLabel}
              value={filter}
              onValueChange={setFilter}
              options={Object.values(TRANSACTION_FILTERS).map((value) => ({
                value,
                label: TRANSACTIONS_COPY.filters[value],
              }))}
            />
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm focus-within:outline-2 focus-within:outline-focus sm:w-64 sm:flex-none max-sm:order-last max-sm:basis-full">
              <Search aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
              <span className="sr-only">{TRANSACTIONS_COPY.search}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={TRANSACTIONS_COPY.searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-subtle"
              />
            </label>
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Download aria-hidden className="size-[var(--fw-icon-sm)]" />
              {TRANSACTIONS_COPY.exportCsv}
            </button>
          </div>
        )}
      </div>

      {list.isError && !list.data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-4 px-5 py-6 text-sm text-muted"
        >
          {TRANSACTIONS_COPY.failed}
          <Button size="sm" variant="secondary" onClick={list.refetch}>
            {TRANSACTIONS_COPY.retry}
          </Button>
        </div>
      ) : !list.data ? (
        <Skeleton className="m-5 h-24" />
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted">{TRANSACTIONS_COPY.empty}</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted">{TRANSACTIONS_COPY.noMatch}</p>
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
                  <tr
                    key={transactionKey(t)}
                    className="hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]"
                  >
                    <td className="px-5 py-3">
                      {/* Below 2xl the network moves under the counterparty, so no amount lacks it. */}
                      <Party t={t} detail={chainName(t.chainId)} detailClassName="2xl:hidden" />
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap text-muted 2xl:table-cell">
                      {chainName(t.chainId)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">
                      <time dateTime={t.at}>{DATE.format(new Date(t.at))}</time>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={transactionStatus(t)} />
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
                  detail={`${chainName(t.chainId)} · ${DATE.format(new Date(t.at))}`}
                />
                <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <Amount t={t} />
                  <StatusPill status={transactionStatus(t)} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview || !list.data ? null : more && limit < TRANSACTIONS_MAX ? (
        <Button
          variant="secondary"
          size="sm"
          className={pageHeading ? "self-start" : "m-4 self-start"}
          loading={list.isFetching && items.length < limit}
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
  detail?: string;
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
              <span className="font-mono font-normal text-muted" title={t.counterparty}>
                {shortAddress(t.counterparty)}
              </span>
            </>
          )}
        </span>
        {detail ? (
          <span className={`block truncate text-xs text-muted ${detailClassName}`}>{detail}</span>
        ) : null}
      </span>
    </span>
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
