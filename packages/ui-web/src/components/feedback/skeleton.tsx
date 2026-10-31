import { cx } from "../../lib/cx";

export interface SkeletonProps {
  className?: string;
}

// A placeholder waits before it fades in, so an answer that comes quickly never flashes one; then it pulses while
// the wait goes on (base.css). It takes the line color: on a surface-2 placeholder a half-opacity pulse spans only a
// few shades in either theme, so it stepped instead of breathing.
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      data-skeleton
      className={cx(
        "block animate-[fw-pulse_calc(var(--fw-duration-slower)*2)_var(--fw-ease-pulse)_var(--fw-duration-slow)_infinite,fw-reveal_var(--fw-duration-base)_var(--fw-ease-out)_var(--fw-duration-slow)_both] rounded-md bg-line",
        className,
      )}
    />
  );
}
