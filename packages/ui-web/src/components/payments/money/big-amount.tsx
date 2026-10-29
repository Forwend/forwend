import { cx } from "../../../lib/cx";

export interface BigAmountProps {
  /** Formatted digits, such as "18,420.50". */
  value: string;
  unit?: string;
  className?: string;
}

/** A headline figure: the whole part leads, the cents and unit step back so the eye lands on the size first. */
export function BigAmount({ value, unit, className }: BigAmountProps) {
  const [whole, cents] = value.split(".");
  return (
    <span
      data-money
      className={cx(
        "inline-flex items-baseline gap-2 font-medium tracking-[-0.04em] text-ink tabular-nums",
        className,
      )}
    >
      <span>
        {whole}
        {cents !== undefined ? (
          <span className="text-[0.6em] tracking-[-0.02em] text-subtle">.{cents}</span>
        ) : null}
      </span>
      {unit ? (
        <span className="text-[0.32em] font-normal tracking-normal text-subtle">{unit}</span>
      ) : null}
    </span>
  );
}
