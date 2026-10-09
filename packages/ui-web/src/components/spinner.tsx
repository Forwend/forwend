import { cx } from "../lib/cx";
import type { LoaderProps } from "../types/ui/motion";

/** A ring with a moving arc, for short waits inside buttons and small areas. */
export function Spinner({ label = "Loading", className }: LoaderProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      className={cx(
        "size-[var(--fw-icon-lg)] animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]",
        className,
      )}
    >
      <circle cx="12" cy="12" r="9" stroke="var(--fw-line)" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="var(--fw-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
