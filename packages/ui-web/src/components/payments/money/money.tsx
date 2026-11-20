import { Fragment } from "react";
import { cx } from "../../../lib/cx";
import { formatTokenAmount, type TokenAmountInput } from "./token-amount";

export interface MoneyProps extends TokenAmountInput {
  token?: string;
  sign?: string;
  nowrap?: boolean;
  className?: string;
}

export function Money({
  baseUnits,
  decimals,
  token,
  sign,
  fractionDigits,
  nowrap = false,
  className,
}: MoneyProps) {
  const groups = formatTokenAmount({ baseUnits, decimals, fractionDigits }).split(",");
  return (
    <span
      data-money
      className={cx(
        "inline-flex items-baseline gap-x-1.5",
        nowrap ? "flex-nowrap whitespace-nowrap" : "flex-wrap",
        className,
      )}
    >
      <span data-figures className="font-medium tabular-nums">
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
