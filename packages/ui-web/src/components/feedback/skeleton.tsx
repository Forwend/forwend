import { cx } from "../../lib/cx";

export interface SkeletonProps {
  className?: string;
}

// A placeholder shows at once, so a page answers the tap right away, and pulses while the wait goes on (base.css).
// It takes the line color: on a surface-2 placeholder a half-opacity pulse spans only a few shades in either theme,
// so it stepped instead of breathing.
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      data-skeleton
      className={cx(
        "block animate-[fw-pulse_calc(var(--fw-duration-slower)*2)_var(--fw-ease-pulse)_infinite] rounded-md bg-line",
        className,
      )}
    />
  );
}
