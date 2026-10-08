import { cx } from "../lib/cx";
import type { LogoMarkProps, LogoProps } from "../types/ui/icons";
import { LOGO_MARK } from "./logo-data";

/** The Forwend mark in the current text color. */
export function LogoMark({ className, label }: LogoMarkProps) {
  return (
    <svg
      viewBox={LOGO_MARK.viewBox}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cx("shrink-0", className)}
    >
      <path d={LOGO_MARK.d} />
    </svg>
  );
}

/** Mark plus the "Forwend" wordmark, for the nav, footer and other brand spots. */
export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 font-semibold tracking-tight text-ink",
        className,
      )}
    >
      <LogoMark className="size-[var(--fw-icon-lg)]" />
      Forwend
    </span>
  );
}
