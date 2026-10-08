import { cx } from "../lib/cx";
import type { LoaderProps, ShimmerProps, SuccessCheckProps } from "../types/ui/motion";

// Motion components. Keyframes live in design-tokens base.css; the reduced-motion rule there
// stops them all, so each one still reads correctly when still.

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

/** Three dots that rise in turn, like the steps of a payment, for waiting on the network. */
export function DotLoader({ label = "Waiting for the network", className }: LoaderProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cx("inline-flex items-center gap-1.5", className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="size-2 rounded-pill bg-accent animate-[fw-dot_var(--fw-duration-slower)_var(--fw-ease-in-out)_infinite]"
          style={{ animationDelay: `calc(var(--fw-duration-fast) * ${i})` }}
        />
      ))}
    </span>
  );
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

/** A circle and a tick that draw themselves once, for "settled" and "you're on the list". */
export function SuccessCheck({ label = "Done", className }: SuccessCheckProps) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 48 48"
      fill="none"
      className={cx("size-12 text-success", className)}
    >
      <circle
        cx="24"
        cy="24"
        r="21"
        stroke="currentColor"
        strokeWidth="3"
        pathLength={1}
        strokeDasharray="1"
        className="animate-[fw-draw-in_var(--fw-duration-slow)_var(--fw-ease-out)_both]"
      />
      <path
        d="m15 24.5 6 6 12-13"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        className="animate-[fw-draw-in_var(--fw-duration-slow)_var(--fw-ease-out)_both] [animation-delay:var(--fw-duration-slow)]"
      />
    </svg>
  );
}
