"use client";

import { Button, buttonClasses, EmptyState, Skeleton, StatusPill } from "@forwend/ui-web";
import { Plus } from "lucide-react";
import Link from "next/link";
import { InvoiceAmount } from "@/features/invoices/invoice-amount";
import {
  formatDueDate,
  type InvoiceSummary,
  type InvoiceToken,
  invoiceNumber,
  invoiceStatus,
} from "@/features/invoices/invoices";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/invoices-api";
import { INVOICES_COPY as COPY } from "@/features/invoices/invoices-copy";
import { chainName } from "@/shared/chains/chains";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

function NewInvoiceLink({ className = "" }: { className?: string }) {
  return (
    <Link href={APP_ROUTES.newInvoice} className={`${buttonClasses({ size: "sm" })} ${className}`}>
      <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.newInvoice}
    </Link>
  );
}

const invoiceHref = (inv: InvoiceSummary) => `${APP_ROUTES.invoices}/${inv.invoiceId}`;

const clientName = (inv: InvoiceSummary) => inv.client?.name ?? inv.client?.email ?? null;

export function InvoicesTable({
  profileId,
  tokens,
}: {
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
}) {
  const list = useGetInvoicesInfiniteQuery(profileId, LIVE_QUERY);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section
      aria-labelledby="invoices-title"
      aria-busy={!list.data && !list.isError}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="invoices-title" className="text-2xl font-semibold tracking-tight text-ink">
          {COPY.invoices}
        </h1>
        {items.length > 0 ? <NewInvoiceLink /> : null}
      </div>

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
          action={<NewInvoiceLink />}
        />
      ) : (
        <div className="rounded-md border border-line bg-surface">
          {/* Wide screens: a ruled table, scrolled sideways rather than squeezed when its column is narrow. Below xl
              the sidebar leaves too little room for five columns, so rows stack as on phones. */}
          <div className="hidden overflow-x-auto xl:block">
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
                {items.map((inv) => (
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
          <ul className="divide-y divide-line xl:hidden">
            {items.map((inv) => (
              <li key={inv.invoiceId}>
                <Link
                  href={invoiceHref(inv)}
                  className="flex items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {invoiceNumber(inv.number)}
                      {clientName(inv) ? (
                        <span className="font-normal text-muted"> · {clientName(inv)}</span>
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
