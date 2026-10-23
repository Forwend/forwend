import { cx } from "../../lib/cx";

export interface SuccessCheckProps {
  label?: string;
  className?: string;
}

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
