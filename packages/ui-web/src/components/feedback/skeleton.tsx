import { cx } from "../../lib/cx";

export interface SkeletonProps {
  className?: string;
}

// A placeholder waits before it fades in, so an answer that comes quickly never flashes one; then it pulses while
// the wait goes on. The fade is listed last so it governs opacity until it ends.
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      data-skeleton
      className={cx(
        "block animate-[fw-pulse_calc(var(--fw-duration-slower)*2)_var(--fw-ease-in-out)_var(--fw-duration-slow)_infinite,fw-fade-in_var(--fw-duration-base)_var(--fw-ease-out)_var(--fw-duration-slow)_both] rounded-md bg-surface-2",
        className,
      )}
    />
  );
}
