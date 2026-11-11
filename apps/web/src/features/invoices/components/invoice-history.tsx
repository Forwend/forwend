"use client";

import {
  EmptyState,
  SegmentedControl,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { History } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  HISTORY_CATEGORIES,
  HISTORY_CATEGORY_OF,
  HISTORY_FIELDS,
  HISTORY_FILTERS,
  HISTORY_KINDS,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { formatDueDate, invoiceNumber } from "@/features/invoices/lib/invoices";
import type {
  HistoryCategory,
  HistoryFilter,
  Invoice,
  InvoiceHistoryEvent,
  InvoiceViews,
} from "@/features/invoices/types/invoices";

const COPY = INVOICE_COPY.history;
const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const TIME_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const FILTERS = Object.values(HISTORY_FILTERS)
  .filter((value) => value !== HISTORY_FILTERS.payment)
  .map((value) => ({
    value,
    label: COPY.filters[value],
  }));
const DOT: Record<HistoryCategory, string> = {
  [HISTORY_CATEGORIES.payment]: "bg-success",
  [HISTORY_CATEGORIES.change]: "bg-subtle",
  [HISTORY_CATEGORIES.email]: "bg-info",
};

interface Line {
  row: InvoiceHistoryEvent;
  label: string;
  category: HistoryCategory;
  by: string;
  details: ReactNode;
}

export interface InvoiceHistoryProps {
  invoice: Pick<Invoice, "payToken">;
  history: readonly InvoiceHistoryEvent[];
  views: InvoiceViews | null;
}

/** R-124: every change to the invoice, newest first; each time is the server's. */
export function InvoiceHistory({ invoice, history, views }: InvoiceHistoryProps) {
  const [filter, setFilter] = useState<HistoryFilter>(HISTORY_FILTERS.all);
  const lines = history
    .map(lineOf)
    .filter(
      (line) =>
        line.category !== HISTORY_CATEGORIES.payment &&
        (filter === HISTORY_FILTERS.all || line.category === filter),
    );
  return (
    <section aria-labelledby="invoice-history" className="fw-panel">
      <div className="fw-panel-head flex-wrap justify-between gap-y-2">
        <h2 id="invoice-history" className="text-base font-semibold text-ink">
          {COPY.title}
        </h2>
        <SegmentedControl
          label={COPY.filter}
          options={FILTERS}
          value={filter}
          onValueChange={setFilter}
          size="sm"
        />
      </div>
      {lines.length === 0 ? (
        <EmptyState compact icon={History} title={COPY.none} />
      ) : (
        <>
          {/* The panel's width decides, not the screen's: it is two thirds of a wide page. */}
          <div className="hidden overflow-x-auto @xl:block">
            <table className="w-full text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col">{COPY.columns.event}</th>
                  <th scope="col">{COPY.columns.by}</th>
                  <th scope="col">{COPY.columns.details}</th>
                  <th scope="col" className="text-right">
                    {COPY.columns.time}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((line) => (
                  <tr
                    key={line.row.id}
                    className={`transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)]`}
                  >
                    <td>
                      <Event line={line} />
                    </td>
                    <td className="text-muted">{line.by}</td>
                    <td className="text-ink">{line.details ?? <None />}</td>
                    <td className="text-right whitespace-nowrap text-muted tabular-nums">
                      <Time at={line.row.at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line @xl:hidden">
            {lines.map((line) => (
              <li key={line.row.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:px-5">
                <span className="flex items-baseline justify-between gap-3">
                  <Event line={line} />
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    <Time at={line.row.at} />
                  </span>
                </span>
                <span className="pl-4 text-xs text-muted">
                  {line.by}
                  {line.details ? <> · {line.details}</> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* An invoice made before pay links (R-114) has none to open. */}
      {views && invoice.payToken ? (
        <p className="border-t border-line px-4 py-3 text-sm text-muted sm:px-5">
          {views.firstAt && views.lastAt ? (
            <>
              {COPY.opened(views.count)}
              {" · "}
              {views.count > 1 ? `${COPY.first} ` : null}
              <Time at={views.firstAt} />
              {views.count > 1 ? (
                <>
                  {` · ${COPY.last} `}
                  <Time at={views.lastAt} />
                </>
              ) : null}
            </>
          ) : (
            COPY.notOpened
          )}
        </p>
      ) : null}
    </section>
  );
}

const STEPS: Record<string, string> = COPY.steps;
const FIELDS: Record<string, string> = COPY.fields;

function lineOf(row: InvoiceHistoryEvent): Line {
  const known = row.kind in COPY.kinds ? (row.kind as keyof typeof COPY.kinds) : null;
  return {
    row,
    label: known ? COPY.kinds[known] : row.kind,
    category: known ? HISTORY_CATEGORY_OF[known] : HISTORY_CATEGORIES.change,
    by: COPY.actors[row.actor as keyof typeof COPY.actors] ?? row.actor,
    details: detailsOf(row),
  };
}

function detailsOf(row: InvoiceHistoryEvent): ReactNode {
  switch (row.kind) {
    case HISTORY_KINDS.invoiceEmailed:
    case HISTORY_KINDS.invoiceEmailFailed:
      return COPY.toClient;
    case HISTORY_KINDS.reminderEmailed:
    case HISTORY_KINDS.reminderEmailFailed:
      return row.step ? (STEPS[row.step] ?? row.step) : null;
    case HISTORY_KINDS.receiptEmailed:
    case HISTORY_KINDS.receiptEmailFailed:
      return COPY.toPayer;
    case HISTORY_KINDS.remindersStopped:
      return COPY.stoppedByLink;
    case HISTORY_KINDS.replaced:
      return row.related ? COPY.replacedBy(invoiceNumber(row.related.number)) : null;
    case HISTORY_KINDS.created:
      return row.related ? COPY.replaces(invoiceNumber(row.related.number)) : null;
    case HISTORY_KINDS.checkoutCloseChanged:
      return row.until ? COPY.closeChanged(TIME_WITH_YEAR.format(new Date(row.until))) : null;
    case HISTORY_KINDS.reopened:
      return row.until ? COPY.reopenedUntil(TIME_WITH_YEAR.format(new Date(row.until))) : null;
    case HISTORY_KINDS.edited: {
      const field = row.field ? (FIELDS[row.field] ?? row.field) : null;
      const day = (date: string | null) => (date ? formatDueDate(date) : COPY.noDate);
      return field && row.field === HISTORY_FIELDS.dueDate
        ? COPY.moved(field, day(row.from), day(row.to))
        : field;
    }
  }
  return null;
}

function Event({ line }: { line: Line }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium text-ink @xl:whitespace-nowrap">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[line.category]}`} />
      {line.label}
    </span>
  );
}

function Time({ at }: { at: string }) {
  const when = new Date(at);
  const format = when.getFullYear() === new Date().getFullYear() ? TIME : TIME_WITH_YEAR;
  return <time dateTime={at}>{format.format(when)}</time>;
}

function None() {
  return <span className="text-subtle">{COPY.noDetails}</span>;
}
