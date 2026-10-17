import { formatTokenAmount } from "@forwend/ui-web";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceLine } from "@/features/invoices/types/invoices";
import { exactDigits } from "@/shared/lib/money";

export interface InvoiceLinesProps {
  lines: readonly InvoiceLine[];
  /** The decimals of the option whose id is the invoice's: the lines are in its base units. */
  decimals: number;
  unit: string;
  total: bigint;
}

// "7.50" reads as 7.5, and "2.00" as 2.
const quantity = (q: string) => q.replace(/\.?0+$/, "");

// R-88: the invoice's items, one row each with its quantity and unit price under the description and its amount on
// the right, then the total; the same rows on every width, as the PDF lists them.
export function InvoiceLines({ lines, decimals, unit, total }: InvoiceLinesProps) {
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
        {lines.map((line, i) => (
          // Lines never change and keep their order, so the position is their key.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <li key={i} className="flex items-start justify-between gap-4 px-4 py-3 text-sm sm:px-5">
            <span className="min-w-0">
              <span className="block break-words text-ink">{line.description}</span>
              <span className="block text-xs text-muted tabular-nums">
                {quantity(line.quantity)} × {money(line.unitPrice)}
              </span>
            </span>
            <span className="shrink-0 font-medium text-ink tabular-nums">{money(line.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-baseline justify-between gap-4 border-t border-line px-4 py-3 sm:px-5">
        <span className="text-sm text-muted">{COPY.itemsTotal}</span>
        <span className="font-semibold text-ink tabular-nums">{money(total)}</span>
      </p>
    </section>
  );
}
