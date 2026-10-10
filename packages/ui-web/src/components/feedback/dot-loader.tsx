import { cx } from "../../lib/cx";
import type { LoaderProps } from "../../types/loader";

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
