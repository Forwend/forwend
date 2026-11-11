import { cx } from "../../lib/cx";
import type { LoaderProps } from "../../types/loader";

// A size in className would lose to the default size class, so the size is its own prop.
const SIZES = {
  md: "size-[var(--fw-icon-md)]",
  lg: "size-[var(--fw-icon-lg)]",
  xl: "size-12",
  "2xl": "size-16",
  "3xl": "size-22",
} as const;

export interface SpinnerProps extends LoaderProps {
  size?: keyof typeof SIZES;
}

/** For short waits inside buttons and small areas. */
export function Spinner({ label = "Loading", size = "lg", className }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      data-motion="essential"
      viewBox="0 0 24 24"
      fill="none"
      className={cx(
        SIZES[size],
        "animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]",
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
