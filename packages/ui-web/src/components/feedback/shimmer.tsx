import { cx } from "../../lib/cx";

export interface ShimmerProps {
  className?: string;
}

/** A placeholder block with a soft light sweep, while content loads. */
export function Shimmer({ className }: ShimmerProps) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative block overflow-hidden rounded-md bg-surface-2 after:absolute after:inset-0 after:animate-[fw-shimmer_calc(var(--fw-duration-slower)*1.6)_var(--fw-ease-in-out)_infinite] after:bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--fw-surface)_70%,transparent),transparent)]",
        className,
      )}
    />
  );
}
