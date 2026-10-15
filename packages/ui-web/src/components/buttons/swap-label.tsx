import { cx } from "../../lib/cx";

export interface SwapLabelProps {
  /** Every label the control can show, such as Copy and Copied. */
  labels: readonly string[];
  active: string;
  className?: string;
}

/** A label that changes words without changing the control's width: every label takes the same cell and only the
 * active one shows, so the row beside it never reflows (a copied address once wrapped onto two lines). */
export function SwapLabel({ labels, active, className }: SwapLabelProps) {
  return (
    <span className={cx("inline-grid", className)}>
      {labels.map((label) => (
        <span
          key={label}
          aria-hidden={label === active ? undefined : true}
          className={cx("col-start-1 row-start-1 text-center", label !== active && "invisible")}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
