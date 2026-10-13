import { Fragment } from "react";
import { cx } from "../../../lib/cx";
import { formatTokenAmount, type TokenAmountInput } from "./token-amount";

export interface MoneyProps extends TokenAmountInput {
  token?: string;
  /** Set before the figures, such as + or − for money in or out. */
  sign?: string;
  className?: string;
}

export function Money({ baseUnits, decimals, token, sign, fractionDigits, className }: MoneyProps) {
  const groups = formatTokenAmount({ baseUnits, decimals, fractionDigits }).split(",");
  return (
    <span data-money className={cx("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className="font-mono tabular-nums">
        {sign}
        {/* A huge amount wraps only after a group comma, never inside a group. */}
        {groups.map((group, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one part per digit group, the order never changes
          <Fragment key={index}>
            {index > 0 ? (
              <>
                ,<wbr />
              </>
            ) : null}
            {group}
          </Fragment>
        ))}
      </span>
      {token ? <span className="text-unit text-muted"> {token}</span> : null}
    </span>
  );
}
