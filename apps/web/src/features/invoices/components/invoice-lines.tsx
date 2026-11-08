"use client";

import { Button, formatTokenAmount } from "@forwend/ui-web";
import { useState } from "react";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { shortQuantity } from "@/features/invoices/lib/invoices";
import type { InvoiceLine, OptionFees } from "@/features/invoices/types/invoices";
import { exactDigits } from "@/shared/lib/money";

export interface InvoiceLinesProps {
  lines: readonly InvoiceLine[];
  /** The decimals of the option whose id is the invoice's: the lines are in its base units. */
  decimals: number;
  unit: string;
  total: bigint;
  /** What the payer sent so far, in the same units: adds Received and Still due under the total. */
  received?: bigint;
  /** Rows on the page's own ground, as a checkout lists them, not a panel. */
  plain?: boolean;
  /** The option's fees (R-228). The client's fees show before the total; owner adds what the owner receives. */
  fees?: OptionFees;
  owner?: boolean;
}

// An invoice can list up to 100 lines: past these, the rest wait behind Show all so the total stays in reach.
const SHOWN = 10;

// R-88: the same rows on every width, as the PDF lists them.
export function InvoiceLines({
  lines,
  decimals,
  unit,
  total,
  received,
  plain,
  fees,
  owner,
}: InvoiceLinesProps) {
  const inset = plain ? "" : "px-4 sm:px-5";
  const [all, setAll] = useState(lines.length <= SHOWN);
  const money = (units: string | bigint) => {
    const baseUnits = BigInt(units);
    return `${formatTokenAmount({ baseUnits, decimals, fractionDigits: exactDigits(baseUnits, decimals) })} ${unit}`;
  };
  return (
    <section aria-labelledby="invoice-items" className={plain ? "flex flex-col" : "fw-panel"}>
      <h2
        id="invoice-items"
        className={
          plain
            ? "border-b border-line pb-2 text-sm font-medium text-muted"
            : "fw-panel-head text-base font-semibold text-ink"
        }
      >
        {lines.length ? COPY.items : COPY.summary}
      </h2>
      <ul className="divide-y divide-line empty:hidden">
        {(all ? lines : lines.slice(0, SHOWN)).map((line, i) => (
          // Lines never change and keep their order, so the position is their key.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <li key={i} className={`flex items-start justify-between gap-4 py-3 text-sm ${inset}`}>
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
        <div className={`border-t border-line py-2.5 ${inset}`}>
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            {COPY.allItems(lines.length)}
          </Button>
        </div>
      )}
      <dl
        className={`flex flex-col gap-2 border-t border-line py-3 text-sm [h2+&]:border-t-0 ${inset} ${plain ? "border-line-strong" : ""}`}
      >
        {fees && fees.total > 0n && fees.clientPays ? (
          <>
            <Row label={COPY.subtotal} value={money(total - fees.total)} />
            <FeeRows fees={fees} money={money} />
          </>
        ) : null}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{COPY.itemsTotal}</dt>
          <dd
            className={`tabular-nums ${received === undefined ? "font-semibold text-ink" : "text-ink"}`}
          >
            {money(total)}
          </dd>
        </div>
        {fees && fees.total > 0n && owner ? (
          <>
            {fees.clientPays ? null : <FeeRows fees={fees} money={money} minus />}
            <Row label={COPY.youReceive} value={money(fees.net)} />
          </>
        ) : null}
        {received === undefined ? null : (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{COPY.received}</dt>
              <dd className="text-ink tabular-nums">{money(received)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
              <dt className="font-medium text-ink">{COPY.stillDue}</dt>
              <dd className="font-semibold text-ink tabular-nums">
                {money(received < total ? total - received : 0n)}
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}

// A fee of 0 shows no line (R-228); minus: deducted from what the owner receives.
function FeeRows({
  fees,
  money,
  minus,
}: {
  fees: OptionFees;
  money: (units: bigint) => string;
  minus?: boolean;
}) {
  const sign = minus ? "−" : "";
  return (
    <>
      {fees.network > 0n ? (
        <Row label={COPY.networkFee} value={`${sign}${money(fees.network)}`} />
      ) : null}
      {fees.platform > 0n ? (
        <Row label={COPY.platformFee} value={`${sign}${money(fees.platform)}`} />
      ) : null}
    </>
  );
}
