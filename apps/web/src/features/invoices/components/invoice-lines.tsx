"use client";

import { Button } from "@forwend/ui-web";
import { useState } from "react";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { shortQuantity } from "@/features/invoices/lib/invoices";
import type { InvoiceLine, OptionFees } from "@/features/invoices/types/invoices";
import { PANEL_TITLE } from "@/shared/constants/panel";
import { amountText } from "@/shared/lib/money";

export interface InvoiceLinesProps {
  lines: readonly InvoiceLine[];
  decimals: number; // of the option whose id is the invoice's
  unit: string;
  total: bigint;
  plain?: boolean;
  fees?: OptionFees;
  owner?: boolean;
}

// Up to 100 lines: past these, the rest wait behind Show all so the total stays in reach.
const SHOWN = 10;

export function InvoiceLines({
  lines,
  decimals,
  unit,
  total,
  plain,
  fees,
  owner,
}: InvoiceLinesProps) {
  const inset = plain ? "" : "px-4 sm:px-5";
  const [all, setAll] = useState(lines.length <= SHOWN);
  const money = (units: string | bigint) => amountText(BigInt(units), { decimals, symbol: unit });
  return (
    <section aria-labelledby="invoice-items" className={plain ? "flex flex-col" : "fw-panel"}>
      <h2
        id="invoice-items"
        className={plain ? "border-b border-line pb-2 text-sm font-medium text-muted" : PANEL_TITLE}
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
          <dd className="font-semibold text-ink tabular-nums">{money(total)}</dd>
        </div>
        {fees && fees.total > 0n && owner ? (
          <>
            {fees.clientPays ? null : <FeeRows fees={fees} money={money} minus />}
            <Row label={COPY.youReceive} value={money(fees.net)} />
          </>
        ) : null}
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

// A fee of 0 shows no line; minus: taken from what the owner receives.
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
