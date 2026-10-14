"use client";

import {
  Button,
  buttonClasses,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
  SegmentedControl,
  StatusPill,
} from "@forwend/ui-web";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { STATUS_FILTERS } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/api/invoices-api";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import { formatDueDate, invoiceNumber, invoiceStatus } from "@/features/invoices/lib/invoices";
import type { InvoiceSummary, InvoiceToken } from "@/features/invoices/types/invoices";
import { NetworkName } from "@/shared/components/chains/network-name";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { useListFilters } from "@/shared/hooks/use-list-filters";

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
        <RowsSkeleton count={SKELETON_ROWS} className="rounded-md border border-line bg-surface" />
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
        <div className="rounded-md border border-line bg-surface">
          {/* Wide screens: a ruled table, scrolled sideways rather than squeezed when its column is narrow. Below xl
              the sidebar leaves too little room for five columns, so rows stack as on phones, as requests always do. */}
          <div className={onRequest ? "hidden" : "hidden overflow-x-auto xl:block"}>
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    {COPY.columns.invoice}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {COPY.columns.client}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {COPY.columns.due}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {COPY.columns.status}
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    {COPY.columns.amount}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((inv) => (
                  // The number's link covers the row, so the whole row opens the invoice.
                  <tr key={inv.invoiceId} className={`relative ${ROW_INTERACTIVE_CLASSES}`}>
                    <td className="max-w-56 px-5 py-3">
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
                    <td
                      title={clientName(inv) ?? undefined}
                      className="max-w-48 truncate px-3 py-3"
                    >
                      {clientName(inv) ?? <span className="text-subtle">{COPY.noClient}</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">
                      {inv.dueDate ? (
                        <time dateTime={inv.dueDate}>{formatDueDate(inv.dueDate)}</time>
                      ) : (
                        <span className="text-subtle">{COPY.noDueDate}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <StatusPill status={invoiceStatus(inv)} />
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <InvoiceAmount invoice={inv} tokens={tokens} className="flex-nowrap" />
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
                  className={`flex items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${ROW_INTERACTIVE_CLASSES}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {invoiceNumber(inv.number)}
                      {label(inv) ? (
                        <span className="font-normal text-muted"> · {label(inv)}</span>
                      ) : null}
                    </span>
                    {/* The network first: a narrow row cuts the due date, never the network. */}
                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
                      <span className="shrink-0">
                        {inv.optionCount > 1 ? (
                          MONEY_COPY.anyNetwork
                        ) : (
                          <NetworkName chainId={inv.chainId} />
                        )}
                      </span>
                      {inv.dueDate ? (
                        <span className="truncate">· {COPY.due(formatDueDate(inv.dueDate))}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                    <InvoiceAmount invoice={inv} tokens={tokens} className="flex-nowrap" />
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
