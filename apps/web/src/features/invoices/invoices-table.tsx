"use client";

import {
  Button,
  buttonClasses,
  EmptyState,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatusPill,
} from "@forwend/ui-web";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { STATUS_FILTERS, type StatusFilter } from "@/features/activity/activity";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { InvoiceAmount } from "@/features/invoices/invoice-amount";
import {
  filterInvoices,
  formatDueDate,
  type InvoiceSummary,
  type InvoiceToken,
  invoiceNumber,
  invoiceStatus,
} from "@/features/invoices/invoices";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/invoices-api";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/invoices-copy";
import { chainName } from "@/shared/chains/chains";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

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
    <button type="button" onClick={onRequest} className={classes}>
      {icon}
      {REQUESTS_COPY.newInvoice}
    </button>
  ) : (
    <Link href={APP_ROUTES.newInvoice} className={classes}>
      {icon}
      {INVOICES_COPY.newInvoice}
    </Link>
  );
}

const invoiceHref = (inv: InvoiceSummary) => `${APP_ROUTES.invoices}/${inv.invoiceId}`;

const clientName = (inv: InvoiceSummary) => inv.client?.name ?? inv.client?.email ?? null;

/** With onRequest the list is a personal profile's requests: no client or due date, so rows show the note. */
export function InvoicesTable({
  profileId,
  tokens,
  onRequest,
}: {
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
  onRequest?: () => void;
}) {
  const COPY = onRequest ? REQUESTS_COPY : INVOICES_COPY;
  const label = (inv: InvoiceSummary) => (onRequest ? inv.note : clientName(inv));
  const list = useGetInvoicesInfiniteQuery(profileId, LIVE_QUERY);
  const [filter, setFilter] = useState<StatusFilter>(STATUS_FILTERS.all);
  const [search, setSearch] = useState("");
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  // Over the pages loaded so far; "Show more" loads older ones into the same filter.
  const rows = filterInvoices(items, filter, search);

  return (
    <section
      aria-labelledby="invoices-title"
      aria-busy={!list.data && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
      <h1 id="invoices-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
        {COPY.invoices}
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
            label={COPY.search}
            value={search}
            onValueChange={setSearch}
            placeholder={COPY.searchPlaceholder}
            className="flex-1 sm:max-w-72"
          />
          <NewInvoiceLink className="ml-auto" onRequest={onRequest} />
        </div>
      ) : null}

      {list.isError && !list.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.data ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <EmptyState
          title={COPY.emptyTitle}
          description={COPY.emptyText}
          action={<NewInvoiceLink onRequest={onRequest} />}
        />
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-line bg-surface px-5 py-8 text-sm text-muted">
          {COPY.noMatch}
        </p>
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
                  <tr
                    key={inv.invoiceId}
                    className="relative hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]"
                  >
                    <td className="max-w-56 px-5 py-3">
                      <Link
                        href={invoiceHref(inv)}
                        className="font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {invoiceNumber(inv.number)}
                      </Link>
                      {inv.title ? (
                        <span className="block truncate text-xs text-muted">{inv.title}</span>
                      ) : null}
                    </td>
                    <td className="max-w-48 truncate px-3 py-3">
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
                      <span className="block text-xs text-muted">{chainName(inv.chainId)}</span>
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
                  className="flex items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {invoiceNumber(inv.number)}
                      {label(inv) ? (
                        <span className="font-normal text-muted"> · {label(inv)}</span>
                      ) : null}
                    </span>
                    {/* The network first: a narrow row cuts the due date, never the network. */}
                    <span className="block truncate text-xs text-muted">
                      {chainName(inv.chainId)}
                      {inv.dueDate ? ` · ${COPY.due(formatDueDate(inv.dueDate))}` : null}
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
    </section>
  );
}
