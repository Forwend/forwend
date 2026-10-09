import { cx } from "../lib/cx";
import { formatTokenAmount } from "../lib/money";
import type { MoneyProps } from "../types/payments/display";

export function Money({ baseUnits, decimals, token, fractionDigits, className }: MoneyProps) {
  return (
    <span data-money className={cx("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className="font-mono tabular-nums tracking-tight">
        {formatTokenAmount({ baseUnits, decimals, fractionDigits })}
      </span>
      {token ? <span className="text-unit text-muted"> {token}</span> : null}
    </span>
  );
}
