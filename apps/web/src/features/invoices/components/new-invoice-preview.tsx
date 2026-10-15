import { Money } from "@forwend/ui-web";
import type {
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { exactDigits } from "@/shared/lib/money";

export interface NewInvoicePreviewProps {
  copy: typeof NEW_INVOICE_COPY.preview | typeof NEW_REQUEST_COPY.preview;
  units: bigint;
  decimals: number;
  unit: string;
  payLine: string;
  title: string;
  note: string;
  client: string;
  due: string | null;
  closes: string;
}

// A visual echo of the form, in the reading order of the pay page; the fields above already say all of it to screen
// readers, so it is hidden from them.
export function NewInvoicePreview({
  copy,
  units,
  decimals,
  unit,
  payLine,
  title,
  note,
  client,
  due,
  closes,
}: NewInvoicePreviewProps) {
  const rows = [
    [copy.client, client || copy.noClient],
    [copy.due, due ?? copy.noDue],
    [copy.closes, closes],
  ] as const;
  return (
    <aside
      aria-hidden
      className="sticky top-24 hidden flex-col rounded-lg border border-line bg-surface xl:flex"
    >
      <p className="border-b border-line px-5 py-4 text-base font-semibold text-ink">
        {copy.title}
      </p>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm text-muted">{title || copy.untitled}</p>
          <Money
            baseUnits={units}
            decimals={decimals}
            fractionDigits={exactDigits(units, decimals)}
            token={unit}
            className="min-w-0 text-amount text-ink"
          />
          <p className="text-sm text-muted">{payLine}</p>
        </div>
        <dl className="flex flex-col divide-y divide-line border-y border-line text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 truncate text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {note ? (
          <p className="line-clamp-4 border-l-2 border-line-strong pl-3 text-sm break-words whitespace-pre-line text-ink">
            {note}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
