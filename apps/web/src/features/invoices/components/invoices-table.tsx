"use client";

import {
  Button,
  COPY_STATUS,
  EmptyState,
  IconButton,
  SearchField,
  StatusPill,
  useCopy,
} from "@forwend/ui-web";
import { Check, Copy, FileText } from "lucide-react";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/api/invoices-api";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { InvoicesAttention } from "@/features/invoices/components/invoices-attention";
import { NewInvoiceLink } from "@/features/invoices/components/new-invoice-link";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  canStillBePaid,
  daysUntilDue,
  invoiceNumber,
  invoiceStatus,
  payLinkUrl,
} from "@/features/invoices/lib/invoices";
import type { InvoiceSummary, InvoiceToken } from "@/features/invoices/types/invoices";
import { NetworkName } from "@/shared/components/chains/network-name";
import { type DataColumn, DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { InitialsAvatar } from "@/shared/components/initials-avatar";
import { ListFilters } from "@/shared/components/list-filters";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { PageTitle } from "@/shared/components/page-title";
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";
import { useListFilters } from "@/shared/hooks/use-list-filters";
import { formatDueDate, formatDueDateShort } from "@/shared/lib/dates";
import { narrowedBy } from "@/shared/lib/payment-state";
import { paymentStateGroup } from "@/shared/lib/payment-state-filter";

const invoiceHref = (inv: InvoiceSummary) => `${APP_ROUTES.invoices}/${inv.invoiceId}`;

const clientName = (inv: InvoiceSummary) => inv.client?.name ?? inv.client?.email ?? null;

const STATES = Object.values(PAYMENT_STATE_FILTERS);
const REQUEST_HIDDEN = new Set(["client", "due", "store"]);

export interface InvoicesTableProps {
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
  onRequest?: () => void;
}

/** With onRequest it lists a personal profile's requests, which rows name by their note. */
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
  const now = new Date();
  const dueDays = (inv: InvoiceSummary) =>
    inv.dueDate && canStillBePaid(inv, invoiceStatus(inv), now)
      ? daysUntilDue(inv.dueDate, now)
      : null;
  const columns = (
    [
      {
        key: "invoice",
        header: COPY.columns.invoice,
        className: "w-32",
        cell: (inv) => <span className="font-medium text-ink">{invoiceNumber(inv.number)}</span>,
      },
      {
        key: "client",
        header: COPY.columns.client,
        placeholder: "lead",
        title: (inv) => clientName(inv),
        cell: (inv) =>
          clientName(inv) ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <InitialsAvatar
                name={clientName(inv)}
                small
                fallback={<FileText className="size-[var(--fw-icon-sm)]" />}
              />
              <span className="truncate text-ink">{clientName(inv)}</span>
            </span>
          ) : (
            <span className="text-subtle">{COPY.noClient}</span>
          ),
      },
      {
        key: "title",
        header: COPY.columns.title,
        from: onRequest ? undefined : "lg",
        cell: (inv) => (
          <span className="text-muted">{inv.title || (onRequest ? inv.note : null) || "—"}</span>
        ),
      },
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
        fit: true,
        title: (inv) => {
          const days = dueDays(inv);
          return days === null ? null : COPY.dueIn(days);
        },
        cell: (inv) => {
          if (!inv.dueDate) return <span className="text-subtle">{COPY.noDueDate}</span>;
          const days = dueDays(inv);
          const late = days !== null && days < 0;
          return (
            <time
              dateTime={inv.dueDate}
              className={`tabular-nums ${late ? "font-medium text-warning" : "text-muted"}`}
            >
              {formatDueDate(inv.dueDate)}
              {late ? <span className="sr-only">, {COPY.dueIn(days)}</span> : null}
            </time>
          );
        },
      },
      {
        key: "status",
        header: COPY.columns.status,
        placeholder: "pill",
        fit: true,
        cell: (inv) => <StatusPill status={invoiceStatus(inv)} />,
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
      {
        key: "amount",
        header: COPY.columns.amount,
        align: "end",
        className: "w-36",
        cell: (inv) => (
          <InvoiceAmount invoice={inv} tokens={tokens} nowrap className="justify-end text-ink" />
        ),
      },
      {
        key: "copy",
        header: COPY.actions,
        headerHidden: true,
        className: "w-14",
        cell: (inv) =>
          inv.payToken && canStillBePaid(inv, invoiceStatus(inv), now) ? (
            <CopyLink payToken={inv.payToken} number={invoiceNumber(inv.number)} />
          ) : null,
      },
    ] satisfies DataColumn<InvoiceSummary>[]
  ).filter((column) => !onRequest || !REQUEST_HIDDEN.has(column.key));

  return (
    <section
      aria-labelledby="invoices-title"
      aria-busy={(!list.currentData && !list.isError) || undefined}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3 lg:contents">
        <PageTitle id="invoices-title">{COPY.invoices}</PageTitle>
        {noInvoices ? null : (
          <NewInvoiceLink size="sm" className="lg:hidden" onRequest={onRequest} />
        )}
      </div>
      {onRequest || noInvoices ? null : <InvoicesAttention profileId={profileId} />}
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
          filter={<ListFilters groups={[paymentStateGroup(filters.filter, filters.setFilter)]} />}
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
        <DataTableSkeleton columns={columns} status count={SKELETON_ROWS} className="fw-panel" />
      ) : noInvoices ? (
        <EmptyState
          page
          icon={FileText}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
          action={<NewInvoiceLink onRequest={onRequest} />}
        />
      ) : rows.length === 0 ? (
        <NoMatch
          page
          onClear={filters.clear}
          title={COPY.noMatchTitle}
          description={narrowedBy(filters.apiQuery, filters.filter)}
        />
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
            columns={columns}
            phone={(inv) => ({
              title: (
                <>
                  {invoiceNumber(inv.number)}
                  {label(inv) ? (
                    <span className="font-normal text-muted"> · {label(inv)}</span>
                  ) : null}
                </>
              ),
              detail: <StatusPill status={invoiceStatus(inv)} />,
              value: <InvoiceAmount invoice={inv} tokens={tokens} nowrap className="justify-end" />,
              meta: inv.dueDate ? (
                <span className="text-xs text-muted">
                  {COPY.due(formatDueDateShort(inv.dueDate, now))}
                </span>
              ) : undefined,
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
      {list.error && data ? (
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

/** It sits over the row's own link. */
function CopyLink({ payToken, number }: { payToken: string; number: string }) {
  const [status, copy] = useCopy(payLinkUrl(payToken));
  const copied = status === COPY_STATUS.copied;
  return (
    <span className="relative z-[1] flex justify-end">
      <IconButton
        size="xs"
        label={
          copied
            ? INVOICES_COPY.linkCopied(number)
            : status === COPY_STATUS.failed
              ? INVOICES_COPY.copyFailed
              : INVOICES_COPY.copyLink(number)
        }
        onClick={() => void copy()}
      >
        {copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
        )}
      </IconButton>
    </span>
  );
}
