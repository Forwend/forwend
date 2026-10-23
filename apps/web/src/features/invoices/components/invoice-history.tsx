"use client";

import { formatTokenAmount, SegmentedControl } from "@forwend/ui-web";
import { useState } from "react";
import {
  HISTORY_CHANGES,
  HISTORY_FILTERS,
  HISTORY_KINDS,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type {
  HistoryFilter,
  Invoice,
  InvoiceHistoryEvent,
} from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const COPY = INVOICE_COPY.history;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const FILTERS = Object.values(HISTORY_FILTERS).map((value) => ({
  value,
  label: COPY.filters[value],
}));

export interface InvoiceHistoryProps {
  invoice: Pick<Invoice, "optionId" | "options">;
  history: readonly InvoiceHistoryEvent[];
}

/** R-124: every change to the invoice, newest first; each time is the server's. */
export function InvoiceHistory({ invoice, history }: InvoiceHistoryProps) {
  const [filter, setFilter] = useState<HistoryFilter>(HISTORY_FILTERS.all);
  const rows = history.filter(
    (row) =>
      filter === HISTORY_FILTERS.all ||
      HISTORY_CHANGES.includes(row.kind) === (filter === HISTORY_FILTERS.changes),
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
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.none}</p>
      ) : (
        <ol className="flex flex-col gap-2 px-4 py-3 text-sm sm:px-5">
          {rows.map((row) => {
            // A row without an option is about the invoice's current one.
            const option = invoice.options.find(
              (o) => o.optionId === (row.optionId ?? invoice.optionId),
            );
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <time dateTime={row.at} className="shrink-0 text-muted tabular-nums sm:w-44">
                  {TIME.format(new Date(row.at))}
                </time>
                <span className="min-w-0 break-words text-ink">
                  {describeRow(row, option)}
                  <span className="text-muted">
                    {" · "}
                    {COPY.actors[row.actor as keyof typeof COPY.actors] ?? row.actor}
                  </span>
                  {row.kind === HISTORY_KINDS.settled && row.txHash && option ? (
                    <ExplorerLink
                      chainId={option.chainId}
                      txHash={row.txHash}
                      className="ml-1 align-middle"
                    />
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function describeRow(
  row: InvoiceHistoryEvent,
  option: Invoice["options"][number] | undefined,
): string {
  const what = COPY.kinds[row.kind as keyof typeof COPY.kinds];
  if (!what) return COPY.other(row.kind);
  const units = BigInt(row.amount ?? 0);
  return what({
    money: option
      ? `${formatTokenAmount({ baseUnits: units, decimals: option.decimals, fractionDigits: exactDigits(units, option.decimals) })} ${option.symbol}`
      : units.toString(),
    symbol: option?.symbol ?? "",
    network: option ? chainName(option.chainId) : "",
  });
}
