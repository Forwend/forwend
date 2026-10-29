"use client";

import { Button, formatTokenAmount } from "@forwend/ui-web";
import { useState } from "react";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { shortQuantity } from "@/features/invoices/lib/invoices";
import type { InvoiceLine } from "@/features/invoices/types/invoices";
import { exactDigits } from "@/shared/lib/money";

export interface InvoiceLinesProps {
  lines: readonly InvoiceLine[];
  /** The decimals of the option whose id is the invoice's: the lines are in its base units. */
  decimals: number;
  unit: string;
  total: bigint;
}

// An invoice can list up to 100 lines: past these, the rest wait behind Show all so the total stays in reach.
const SHOWN = 10;

// R-88: the same rows on every width, as the PDF lists them.
export function InvoiceLines({ lines, decimals, unit, total }: InvoiceLinesProps) {
  const [all, setAll] = useState(lines.length <= SHOWN);
  const money = (units: string | bigint) => {
    const baseUnits = BigInt(units);
    return `${formatTokenAmount({ baseUnits, decimals, fractionDigits: exactDigits(baseUnits, decimals) })} ${unit}`;
  };
  return (
    <section aria-labelledby="invoice-items" className="fw-panel">
      <h2 id="invoice-items" className="fw-panel-head text-base font-semibold text-ink">
        {COPY.items}
      </h2>
      <ul className="divide-y divide-line">
        {(all ? lines : lines.slice(0, SHOWN)).map((line, i) => (
          // Lines never change and keep their order, so the position is their key.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <li key={i} className="flex items-start justify-between gap-4 px-4 py-3 text-sm sm:px-5">
            <span className="min-w-0">
              <span className="block break-words text-ink">{line.description}</span>
              <span className="block text-xs text-muted tabular-nums">
                {shortQuantity(line.quantity)} × {money(line.unitPrice)}
              </span>
            </span>
            <span className="shrink-0 font-medium text-ink tabular-nums">{money(line.amount)}</span>
          </li>
        ))}
      </ul>
      {all ? null : (
        <div className="border-t border-line px-4 py-2.5 sm:px-5">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            {COPY.allItems(lines.length)}
          </Button>
        </div>
      )}
      <p className="flex items-baseline justify-between gap-4 border-t border-line px-4 py-3 sm:px-5">
        <span className="text-sm text-muted">{COPY.itemsTotal}</span>
        <span className="font-semibold text-ink tabular-nums">{money(total)}</span>
      </p>
    </section>
  );
}
