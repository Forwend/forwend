import { cx } from "@forwend/ui-web";
import type { ReactNode } from "react";

export interface MoneyTerm {
  label: string;
  units: bigint;
  after?: ReactNode; // such as an explorer link
}

export interface InvoiceMoneyLineProps {
  terms: readonly MoneyTerm[]; // the first, the amounts taken from it, the result
  money: (units: bigint) => string;
  className?: string;
}

/** "Client pays − Network fee = You receive" as a ruled statement. */
export function InvoiceMoneyLine({ terms, money, className }: InvoiceMoneyLineProps) {
  return (
    <dl
      className={cx(
        "flex flex-col overflow-hidden rounded-md border border-line text-sm",
        className,
      )}
    >
      {terms.map((term, i) => {
        const result = i === terms.length - 1;
        return (
          <div
            key={term.label}
            className={cx(
              "flex items-baseline justify-between gap-4 px-3.5 py-2.5",
              result && "border-t border-line bg-surface-2",
            )}
          >
            <dt className={result ? "font-medium text-ink" : "text-muted"}>{term.label}</dt>
            <dd
              className={cx(
                "flex items-center gap-1 text-ink tabular-nums",
                result && "font-semibold",
              )}
            >
              {i > 0 && !result ? "− " : null}
              {money(term.units)}
              {term.after}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
