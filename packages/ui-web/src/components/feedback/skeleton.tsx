import { cx } from "../../lib/cx";

export interface SkeletonProps {
  className?: string;
}

// Shows at once, so a page answers the tap right away, and pulses while the wait goes on (base.css). The line color:
// on surface-2 a half-opacity pulse spans too few shades in either theme, so it steps instead of breathing.
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
