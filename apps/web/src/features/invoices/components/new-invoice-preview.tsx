import { Money } from "@forwend/ui-web";
import type {
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { exactDigits } from "@/shared/lib/money";

// A summary: the first few lines, then how many more; the form above lists them all.
const PREVIEW_LINES = 5;

export interface PreviewLine {
  id: string;
  description: string;
  quantity: string;
  units: bigint | null;
}

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
  lines: readonly PreviewLine[];
}

/** The invoice as the payer will read it, from what the form holds now: no second input anywhere. */
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
  lines,
}: NewInvoicePreviewProps) {
  const rows = [
    [copy.client, client || copy.noClient],
    [copy.due, due ?? copy.noDue],
    [copy.closes, closes],
  ] as const;
  const amount = (value: bigint) => (
    <Money
      baseUnits={value}
      decimals={decimals}
      fractionDigits={exactDigits(value, decimals)}
      token={unit}
    />
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-sm text-muted">{title || copy.untitled}</p>
        <Money
          baseUnits={units}
          decimals={decimals}
          fractionDigits={exactDigits(units, decimals)}
          token={unit}
          className="min-w-0 text-amount font-medium tracking-tight text-ink"
        />
        <p className="text-sm text-muted">{payLine}</p>
      </div>
      {lines.length ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line text-sm">
          {lines.slice(0, PREVIEW_LINES).map((line) => (
            <li key={line.id} className="flex items-baseline justify-between gap-4 py-2.5">
              <span className="min-w-0">
                <span className="block break-words text-ink">
                  {line.description || copy.noItem}
                </span>
                <span className="block text-xs text-muted">
                  {copy.quantity(line.quantity || "—")}
                </span>
              </span>
              <span className="shrink-0 text-ink tabular-nums">
                {line.units === null ? <span className="text-subtle">—</span> : amount(line.units)}
              </span>
            </li>
          ))}
          {lines.length > PREVIEW_LINES ? (
            <li className="py-2.5 text-xs text-muted">
              {copy.moreItems(lines.length - PREVIEW_LINES)}
            </li>
          ) : null}
        </ul>
      ) : null}
      <dl className="flex flex-col divide-y divide-line border-y border-line text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 truncate text-right text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {note ? (
        <p className="line-clamp-6 rounded-md bg-surface-2 px-3 py-2 text-sm break-words whitespace-pre-line text-ink">
          {note}
        </p>
      ) : null}
    </div>
  );
}
