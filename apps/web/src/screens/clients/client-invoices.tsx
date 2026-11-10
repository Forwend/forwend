"use client";

import { buttonClasses, EmptyState, StatusPill } from "@forwend/ui-web";
import { FileText } from "lucide-react";
import Link from "next/link";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import type { Client } from "@/features/clients/types/clients";
import { useGetInvoicesInfiniteQuery } from "@/features/invoices/api/invoices-api";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { INVOICES_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  formatDueDate,
  formatDueDateShort,
  invoiceNumber,
  invoiceStatus,
} from "@/features/invoices/lib/invoices";
import type { InvoiceSummary } from "@/features/invoices/types/invoices";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";
import { apiSearch, SEARCH_PARAM, withParam } from "@/shared/hooks/use-list-filters";

const invoiceHref = (inv: InvoiceSummary) => `${APP_ROUTES.invoices}/${inv.invoiceId}`;

export interface ClientInvoicesProps {
  profileId: string;
  client: Client;
}

// Invoices keep their own copy of the client, so the list is the Invoices search for the client's email (or its name
// without one): the first page only, with the rest a link away.
export function ClientInvoices({ profileId, client }: ClientInvoicesProps) {
  const search = apiSearch(client.email ?? client.name) ?? "";
  const list = useGetInvoicesInfiniteQuery({ profileId, q: search });
  const tokens = useGetProfileTokensQuery(profileId);
  const rows = list.currentData?.pages[0]?.items ?? [];
  const all = `${APP_ROUTES.invoices}${withParam("", SEARCH_PARAM, search)}`;

  return (
    <section aria-labelledby="client-invoices" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="client-invoices" className="text-base font-semibold text-ink">
            {COPY.invoices}
          </h2>
          <p className="truncate text-xs text-muted">{COPY.invoicesFound(search)}</p>
        </div>
        <Link href={all} className={`${buttonClasses({ variant: "ghost", size: "sm" })} shrink-0`}>
          {COPY.allInvoices}
        </Link>
      </div>
      {list.isError && !list.currentData ? (
        <LoadError
          message={COPY.invoicesFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !list.currentData ? (
        <DataTableSkeleton status count={3} className="fw-panel" />
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title={COPY.noInvoices} description={COPY.noInvoicesText} />
      ) : (
        <DataTable
          label={COPY.invoices}
          rows={rows}
          rowKey={(inv) => inv.invoiceId}
          rowHref={invoiceHref}
          rowLabel={(inv) => [invoiceNumber(inv.number), inv.title].filter(Boolean).join(", ")}
          columns={[
            {
              key: "invoice",
              header: INVOICES_COPY.columns.invoice,
              className: "w-28",
              cell: (inv) => (
                <span className="font-medium text-ink">{invoiceNumber(inv.number)}</span>
              ),
            },
            {
              key: "title",
              header: INVOICES_COPY.columns.title,
              cell: (inv) => <span className="text-muted">{inv.title ?? "—"}</span>,
            },
            {
              key: "due",
              header: INVOICES_COPY.columns.due,
              className: "w-32",
              from: "md",
              cell: (inv) =>
                inv.dueDate ? (
                  <time dateTime={inv.dueDate} className="text-muted tabular-nums">
                    {formatDueDate(inv.dueDate)}
                  </time>
                ) : (
                  <span className="text-subtle">{INVOICES_COPY.noDueDate}</span>
                ),
            },
            {
              key: "status",
              header: INVOICES_COPY.columns.status,
              className: "w-44",
              cell: (inv) => <StatusPill status={invoiceStatus(inv)} />,
            },
            {
              key: "amount",
              header: INVOICES_COPY.columns.amount,
              align: "end",
              className: "w-36",
              cell: (inv) => (
                <InvoiceAmount
                  invoice={inv}
                  tokens={tokens.currentData ?? (tokens.isError ? [] : null)}
                  nowrap
                  className="justify-end text-ink"
                />
              ),
            },
          ]}
          phone={(inv) => ({
            title: inv.title ?? invoiceNumber(inv.number),
            detail: [
              inv.title ? invoiceNumber(inv.number) : null,
              inv.dueDate ? INVOICES_COPY.due(formatDueDateShort(inv.dueDate, new Date())) : null,
            ]
              .filter(Boolean)
              .join(" · "),
            value: (
              <InvoiceAmount
                invoice={inv}
                tokens={tokens.currentData ?? (tokens.isError ? [] : null)}
                nowrap
                className="justify-end"
              />
            ),
            meta: <StatusPill status={invoiceStatus(inv)} />,
          })}
        />
      )}
    </section>
  );
}
