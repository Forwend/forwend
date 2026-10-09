import { cx } from "../../lib/cx";
import type { LoaderProps } from "../../types/loader";

/** A bar for work of unknown length: a segment travels along the track. */
export function ProgressBar({ label = "Working", className }: LoaderProps) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      className={cx(
        "relative block h-1.5 w-full overflow-hidden rounded-pill bg-surface-2",
        className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-2/5 rounded-pill bg-accent animate-[fw-progress_calc(var(--fw-duration-slower)*1.4)_var(--fw-ease-in-out)_infinite]" />
    </span>
  );
}
