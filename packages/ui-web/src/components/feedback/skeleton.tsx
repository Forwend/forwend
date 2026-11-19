import { cx } from "../../lib/cx";

export interface SkeletonProps {
  className?: string;
}

// The line color: a pulse on surface-2 spans too few shades to read (the animation is in base.css).
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
