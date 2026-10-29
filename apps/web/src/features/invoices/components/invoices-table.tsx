"use client";

import {
  Button,
  type ButtonSize,
  buttonClasses,
  EmptyState,
  SearchField,
  StatusPill,
} from "@forwend/ui-web";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
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
import { ChainBadge } from "@/shared/components/chains/chain-badge";
import { NetworkName } from "@/shared/components/chains/network-name";
import { type DataColumn, DataTable } from "@/shared/components/data-table";
import { InitialsAvatar } from "@/shared/components/initials-avatar";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { PaymentStateFilter } from "@/shared/components/payment-state-filter";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { useListFilters } from "@/shared/hooks/use-list-filters";
import { chainName } from "@/shared/lib/chains";

function NewInvoiceLink({
  className = "",
  size = "md",
  onRequest,
}: {
  className?: string;
  size?: ButtonSize;
  onRequest?: () => void;
}) {
  const icon = <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />;
  return onRequest ? (
    <Button size={size} onClick={onRequest} className={className}>
      {icon}
      {REQUESTS_COPY.newInvoice}
    </Button>
  ) : (
    <Link href={APP_ROUTES.newInvoice} className={`${buttonClasses({ size })} ${className}`}>
      {icon}
      {INVOICES_COPY.newInvoice}
    </Link>
  );
}

const invoiceHref = (inv: InvoiceSummary) => `${APP_ROUTES.invoices}/${inv.invoiceId}`;

const clientName = (inv: InvoiceSummary) => inv.client?.name ?? inv.client?.email ?? null;

// A merchant invoice's store (R-134) follows its title.

export interface InvoicesTableProps {
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
  onRequest?: () => void;
}

/** With onRequest the list is a personal profile's requests: no client or due date, so rows show the note. */
const STATES = Object.values(PAYMENT_STATE_FILTERS);
const REQUEST_HIDDEN = new Set(["client", "due", "store"]);

export function InvoicesTable({ profileId, tokens, onRequest }: InvoicesTableProps) {
  const COPY = onRequest ? REQUESTS_COPY : INVOICES_COPY;
  const label = (inv: InvoiceSummary) => (onRequest ? inv.note : clientName(inv));
  const filters = useListFilters("state", STATES, PAYMENT_STATE_FILTERS.all);
  const list = useGetInvoicesInfiniteQuery(
    { profileId, state: filters.apiFilter, q: filters.apiQuery },
    LIVE_QUERY,
  );
  // A new filter keeps the last rows in place, dimmed and busy, until its own answer arrives.
  const data = list.currentData ?? (list.isFetching ? list.data : undefined);
  const stale = !list.currentData && Boolean(data);
  const rows = data?.pages.flatMap((page) => page.items) ?? [];
  const noInvoices = !filters.filtered && list.currentData && rows.length === 0;

  return (
    <section
      aria-labelledby="invoices-title"
      aria-busy={(!list.currentData && !list.isError) || undefined}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading and its action show only below that. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        <h1
          id="invoices-title"
          className="text-2xl font-semibold tracking-tight text-ink lg:sr-only"
        >
          {COPY.invoices}
        </h1>
        {/* An empty list offers it in its own block instead. */}
        {noInvoices ? null : (
          <NewInvoiceLink size="sm" className="lg:hidden" onRequest={onRequest} />
        )}
      </div>
      {!noInvoices ? (
        <ListToolbar
          search={
            <SearchField
              label={COPY.search}
              value={filters.search}
              onValueChange={filters.setSearch}
              placeholder={COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          filter={<PaymentStateFilter value={filters.filter} onValueChange={filters.setFilter} />}
          actions={<NewInvoiceLink className="max-lg:hidden" onRequest={onRequest} />}
        />
      ) : null}

      {list.isError && !data ? (
        <LoadError
          page
          message={COPY.failed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !data ? (
        <RowsSkeleton count={SKELETON_ROWS} className="fw-panel" />
      ) : noInvoices ? (
        <EmptyState
          page
          icon={FileText}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
          action={<NewInvoiceLink onRequest={onRequest} />}
        />
      ) : rows.length === 0 ? (
        <NoMatch page onClear={filters.clear} />
      ) : (
        <div
          className={
            stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : undefined
          }
        >
          <DataTable
            label={COPY.invoices}
            rows={rows}
            rowKey={(inv) => inv.invoiceId}
            rowHref={invoiceHref}
            rowLabel={(inv) => [invoiceNumber(inv.number), label(inv)].filter(Boolean).join(", ")}
            // A request has no client, due date or store: those columns leave, the rest match Invoices.
            columns={(
              [
                {
                  key: "invoice",
                  header: COPY.columns.invoice,
                  className: "w-32",
                  cell: (inv) => (
                    <span className="font-medium text-ink">{invoiceNumber(inv.number)}</span>
                  ),
                },
                {
                  key: "client",
                  header: COPY.columns.client,
                  title: (inv) => clientName(inv),
                  cell: (inv) =>
                    clientName(inv) ? (
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={clientName(inv)} small />
                        <span className="truncate text-ink">{clientName(inv)}</span>
                      </span>
                    ) : (
                      <span className="text-subtle">{COPY.noClient}</span>
                    ),
                },
                {
                  key: "title",
                  header: COPY.columns.title,
                  // A request is named by its note, so the column stays at every width; an invoice's client comes first.
                  from: onRequest ? undefined : "lg",
                  cell: (inv) => (
                    <span className="text-muted">
                      {inv.title || (onRequest ? inv.note : null) || "—"}
                    </span>
                  ),
                },
                // A freelancer's invoices belong to no store, so the column shows only when one does.
                ...(rows.some((inv) => inv.store)
                  ? [
                      {
                        key: "store",
                        header: COPY.columns.store,
                        from: "xl",
                        cell: (inv: InvoiceSummary) => (
                          <span className="text-muted">{inv.store?.name ?? "—"}</span>
                        ),
                      } satisfies DataColumn<InvoiceSummary>,
                    ]
                  : []),
                {
                  key: "due",
                  header: COPY.columns.due,
                  className: "w-32",
                  cell: (inv) =>
                    inv.dueDate ? (
                      <time dateTime={inv.dueDate} className="text-muted tabular-nums">
                        {formatDueDate(inv.dueDate)}
                      </time>
                    ) : (
                      <span className="text-subtle">{COPY.noDueDate}</span>
                    ),
                },
                {
                  key: "status",
                  header: COPY.columns.status,
                  className: "w-44",
                  cell: (inv) => <StatusPill status={invoiceStatus(inv)} />,
                },
                {
                  key: "amount",
                  header: COPY.columns.amount,
                  align: "end",
                  className: "w-36",
                  cell: (inv) => (
                    <InvoiceAmount
                      invoice={inv}
                      tokens={tokens}
                      className="flex-nowrap justify-end text-ink"
                    />
                  ),
                },
                {
                  key: "network",
                  header: COPY.columns.network,
                  from: "md",
                  className: "w-36",
                  cell: (inv) =>
                    inv.optionCount > 1 ? (
                      <span className="text-muted">{MONEY_COPY.anyNetwork}</span>
                    ) : (
                      <span className="text-muted">
                        <NetworkName chainId={inv.chainId} />
                      </span>
                    ),
                },
              ] satisfies DataColumn<InvoiceSummary>[]
            ).filter((column) => !onRequest || !REQUEST_HIDDEN.has(column.key))}
            phone={(inv) => ({
              // A request's note is no name, so its avatar keeps the document icon.
              leading: (
                <Avatar
                  name={onRequest ? null : label(inv)}
                  chainId={inv.optionCount > 1 ? null : inv.chainId}
                />
              ),
              title: label(inv) ?? invoiceNumber(inv.number),
              detail: [
                label(inv) ? invoiceNumber(inv.number) : null,
                inv.dueDate ? COPY.due(formatDueDateShort(inv.dueDate, new Date())) : null,
                inv.optionCount > 1 ? MONEY_COPY.anyNetwork : chainName(inv.chainId),
                inv.store?.name,
              ]
                .filter(Boolean)
                .join(" · "),
              value: (
                <InvoiceAmount invoice={inv} tokens={tokens} className="flex-nowrap justify-end" />
              ),
              meta: <StatusPill status={invoiceStatus(inv)} />,
            })}
            footer={
              list.hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {COPY.loadMore}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {list.isError && data ? (
        <LoadError
          inline
          message={COPY.updateFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
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
  chainId?: number | null;
  small?: boolean;
}) {
  return (
    <InitialsAvatar
      name={name}
      small={small}
      fallback={<FileText className="size-[var(--fw-icon-sm)]" />}
    >
      {chainId ? <ChainBadge chainId={chainId} /> : null}
    </InitialsAvatar>
  );
}
