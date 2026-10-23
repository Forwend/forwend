"use client";

import {
  formatTokenAmount,
  SegmentedControl,
  shortAddress,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { type ReactNode, useState } from "react";
import {
  HISTORY_CATEGORIES,
  HISTORY_CATEGORY_OF,
  HISTORY_FILTERS,
  HISTORY_KINDS,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type {
  HistoryCategory,
  HistoryFilter,
  Invoice,
  InvoiceHistoryEvent,
  InvoiceViews,
} from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

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
const FILTERS = Object.values(HISTORY_FILTERS).map((value) => ({
  value,
  label: COPY.filters[value],
}));
const DOT: Record<HistoryCategory, string> = {
  [HISTORY_CATEGORIES.payment]: "bg-success",
  [HISTORY_CATEGORIES.change]: "bg-subtle",
  [HISTORY_CATEGORIES.email]: "bg-info",
};

type Option = Invoice["options"][number];

interface Line {
  row: InvoiceHistoryEvent;
  label: string;
  category: HistoryCategory;
  by: string;
  details: ReactNode;
}

export interface InvoiceHistoryProps {
  invoice: Pick<Invoice, "optionId" | "options" | "payToken">;
  history: readonly InvoiceHistoryEvent[];
  views: InvoiceViews | null;
}

/** R-124: every change to the invoice, newest first; each time is the server's. */
export function InvoiceHistory({ invoice, history, views }: InvoiceHistoryProps) {
  const [filter, setFilter] = useState<HistoryFilter>(HISTORY_FILTERS.all);
  const lines = history
    .map((row) => lineOf(row, invoice))
    .filter((line) => filter === HISTORY_FILTERS.all || line.category === filter);
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
        <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.none}</p>
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

function lineOf(row: InvoiceHistoryEvent, invoice: InvoiceHistoryProps["invoice"]): Line {
  const known = row.kind in COPY.kinds ? (row.kind as keyof typeof COPY.kinds) : null;
  // A row without an option is about the invoice's current one.
  const option = invoice.options.find((o) => o.optionId === (row.optionId ?? invoice.optionId));
  return {
    row,
    label: known ? COPY.kinds[known] : row.kind,
    category: known ? HISTORY_CATEGORY_OF[known] : HISTORY_CATEGORIES.change,
    by: COPY.actors[row.actor as keyof typeof COPY.actors] ?? row.actor,
    details: detailsOf(row, option),
  };
}

function detailsOf(row: InvoiceHistoryEvent, option: Option | undefined): ReactNode {
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
  }
  if (!option) return null;
  const network = chainName(option.chainId);
  switch (row.kind) {
    case HISTORY_KINDS.paid:
      return money(BigInt(option.amount), option);
    case HISTORY_KINDS.settled:
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          {money(BigInt(option.amount), option)}
          {row.txHash ? (
            <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
              <span className="text-muted">·</span>
              <span className="font-mono text-xs text-muted" title={row.txHash}>
                {shortAddress(row.txHash)}
              </span>
              <ExplorerLink chainId={option.chainId} txHash={row.txHash} />
            </span>
          ) : null}
        </span>
      );
    case HISTORY_KINDS.held:
      return COPY.heldFor(money(BigInt(row.amount ?? 0), option), network);
    case HISTORY_KINDS.optionChosen:
      return `${option.symbol} · ${network}`;
    case HISTORY_KINDS.open:
      return COPY.dropped;
    default:
      return null;
  }
}

const money = (units: bigint, option: Option) =>
  `${formatTokenAmount({ baseUnits: units, decimals: option.decimals, fractionDigits: exactDigits(units, option.decimals) })} ${option.symbol}`;

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
