"use client";

import {
  BrandIcon,
  Button,
  buttonClasses,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
  SegmentedControl,
  StatusPill,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { STATUS_FILTERS } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/api/invoices-api";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  formatDueDate,
  formatDueDateShort,
  invoiceNumber,
  invoiceStatus,
} from "@/features/invoices/lib/invoices";
import type { InvoiceSummary, InvoiceToken } from "@/features/invoices/types/invoices";
import { NetworkName } from "@/shared/components/chains/network-name";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { CHAINS } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { useListFilters } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";

// A personal profile's requests open the request sheet; invoices have their own page.
function NewInvoiceLink({
  className = "",
  onRequest,
}: {
  className?: string;
  onRequest?: () => void;
}) {
  const classes = `${buttonClasses({ size: "sm" })} ${className}`;
  const icon = <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />;
  return onRequest ? (
    <Button size="sm" onClick={onRequest} className={className}>
      {icon}
      {REQUESTS_COPY.newInvoice}
    </Button>
  ) : (
    <Link href={APP_ROUTES.newInvoice} className={classes}>
      {icon}
      {INVOICES_COPY.newInvoice}
    </Link>
  );
}

const invoiceHref = (inv: InvoiceSummary) => `${APP_ROUTES.invoices}/${inv.invoiceId}`;

const clientName = (inv: InvoiceSummary) => inv.client?.name ?? inv.client?.email ?? null;

export interface InvoicesTableProps {
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
  onRequest?: () => void;
}

/** With onRequest the list is a personal profile's requests: no client or due date, so rows show the note. */
export function InvoicesTable({ profileId, tokens, onRequest }: InvoicesTableProps) {
  const COPY = onRequest ? REQUESTS_COPY : INVOICES_COPY;
  const label = (inv: InvoiceSummary) => (onRequest ? inv.note : clientName(inv));
  const filters = useListFilters("status", Object.values(STATUS_FILTERS), STATUS_FILTERS.all);
  const list = useGetInvoicesInfiniteQuery(
    { profileId, status: filters.apiFilter, q: filters.apiQuery },
    LIVE_QUERY,
  );
  // Only the current filter's rows: an older filter's answer never shows.
  const rows = list.currentData?.pages.flatMap((page) => page.items) ?? [];
  const noInvoices = !filters.filtered && list.currentData && rows.length === 0;

  return (
    <section
      aria-labelledby="invoices-title"
      aria-busy={!list.currentData && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 id="invoices-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {COPY.invoices}
      </h1>
      {list.data && !noInvoices ? (
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
            label={COPY.search}
            value={filters.search}
            onValueChange={filters.setSearch}
            placeholder={COPY.searchPlaceholder}
            className="flex-1 sm:max-w-72"
          />
          <NewInvoiceLink className="ml-auto" onRequest={onRequest} />
        </div>
      ) : null}

      {list.isError && !list.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.currentData ? (
        <RowsSkeleton count={SKELETON_ROWS} className="fw-panel" />
      ) : noInvoices ? (
        <EmptyState
          icon={FileText}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
          action={<NewInvoiceLink onRequest={onRequest} />}
        />
      ) : rows.length === 0 ? (
        <NoMatch onClear={filters.clear} />
      ) : (
        <div className="fw-panel overflow-hidden">
          {/* Wide screens: a ruled table, scrolled sideways rather than squeezed when its column is narrow. Below xl
              the sidebar leaves too little room for five columns, so rows stack as on phones, as requests always do. */}
          <div className={onRequest ? "hidden" : "hidden overflow-x-auto xl:block"}>
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col" className="w-[30%]">
                    {COPY.columns.invoice}
                  </th>
                  <th scope="col">{COPY.columns.client}</th>
                  <th scope="col">{COPY.columns.due}</th>
                  <th scope="col">{COPY.columns.status}</th>
                  <th scope="col" className="text-right">
                    {COPY.columns.amount}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((inv) => (
                  // The number's link covers the row, so the whole row opens the invoice.
                  <tr
                    key={inv.invoiceId}
                    className={`relative transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <td className="max-w-64">
                      <Link
                        href={invoiceHref(inv)}
                        className="font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {invoiceNumber(inv.number)}
                      </Link>
                      {inv.title ? (
                        <span title={inv.title} className="block truncate text-xs text-muted">
                          {inv.title}
                        </span>
                      ) : null}
                    </td>
                    <td title={clientName(inv) ?? undefined} className="max-w-56">
                      {clientName(inv) ? (
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={clientName(inv)} small />
                          <span className="truncate text-ink">{clientName(inv)}</span>
                        </span>
                      ) : (
                        <span className="text-subtle">{COPY.noClient}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted tabular-nums">
                      {inv.dueDate ? (
                        <time dateTime={inv.dueDate}>{formatDueDate(inv.dueDate)}</time>
                      ) : (
                        <span className="text-subtle">{COPY.noDueDate}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusPill status={invoiceStatus(inv)} />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <InvoiceAmount
                        invoice={inv}
                        tokens={tokens}
                        className="flex-nowrap justify-end text-ink"
                      />
                      <span className="flex justify-end text-xs text-muted">
                        {inv.optionCount > 1 ? (
                          MONEY_COPY.anyNetwork
                        ) : (
                          <NetworkName chainId={inv.chainId} />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={`divide-y divide-line ${onRequest ? "" : "xl:hidden"}`}>
            {rows.map((inv) => (
              <li key={inv.invoiceId}>
                <Link
                  href={invoiceHref(inv)}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                >
                  {/* Who it is for leads; the number and due date sit under it, and one network rides on the
                      avatar as its logo (and in words for screen readers), so a narrow row cuts neither. */}
                  <Avatar name={label(inv)} chainId={inv.optionCount > 1 ? null : inv.chainId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">
                      {label(inv) ?? invoiceNumber(inv.number)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {label(inv) ? invoiceNumber(inv.number) : null}
                      {inv.dueDate ? (
                        <>
                          {label(inv) ? " · " : null}
                          {COPY.due(formatDueDateShort(inv.dueDate, new Date()))}
                        </>
                      ) : null}
                      {inv.optionCount > 1 ? (
                        ` · ${MONEY_COPY.anyNetwork}`
                      ) : (
                        <span className="sr-only">, {chainName(inv.chainId)}</span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <InvoiceAmount invoice={inv} tokens={tokens} className="flex-nowrap text-ink" />
                    <StatusPill status={invoiceStatus(inv)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {COPY.loadMore}
        </Button>
      ) : null}
      {list.isError && list.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.updateFailed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Avatar({
  name,
  chainId,
  small = false,
}: {
  name: string | null;
  /** The one network the invoice is paid on, shown as its logo on the corner. */
  chainId?: number | null;
  small?: boolean;
}) {
  const chain = chainId ? CHAINS[chainId]?.icon : undefined;
  const letters = name ? initials(name) : "";
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-pill bg-surface-2 font-medium text-muted ${small ? "size-7 text-xs" : "size-9 text-sm"}`}
    >
      {letters || <FileText className="size-[var(--fw-icon-sm)]" />}
      {chain ? (
        <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-pill border-2 border-surface bg-surface">
          <BrandIcon name={chain} className="size-3.5 rounded-sm" />
        </span>
      ) : null}
    </span>
  );
}

// Up to two letters of the client's name, for the avatar beside it.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.match(/\p{L}/u)?.[0] ?? "")
    .join("")
    .toUpperCase();
}
