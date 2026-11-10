import type { ReactNode } from "react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";

export interface AmountRow {
  term: string;
  value: ReactNode;
}

export interface YouSendProps {
  /** The amount with its token, as the payer will be asked to send it. */
  amount: ReactNode;
  /** What the page does not say elsewhere: each fee, how long it takes. Never the invoice's own amount. */
  rows: readonly AmountRow[];
  className?: string;
  children?: ReactNode;
}

/** What the payer sends in another token, before they ask for the address: the amount first, then what it adds to
 * the invoice. A direct payment has none: the page already says its amount. */
export function YouSend({ amount, rows, className = "", children }: YouSendProps) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{COPY.crossChain.youSend}</span>
        <span className="text-3xl font-medium tracking-tight break-words text-ink tabular-nums">
          {amount}
        </span>
      </div>
      <AmountRows rows={rows} className="border-y border-line py-3" />
      {children}
    </div>
  );
}

/** The lines that say what an amount covers. */
export function AmountRows({
  rows,
  className = "",
}: {
  rows: readonly AmountRow[];
  className?: string;
}) {
  return (
    <dl className={`flex flex-col gap-2 text-sm ${className}`}>
      {rows.map((row) => (
        <div key={row.term} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{row.term}</dt>
          <dd className="text-right text-ink tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
