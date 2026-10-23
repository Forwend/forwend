import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/cx";

export interface RowButtonProps extends ComponentPropsWithRef<"button"> {
  /** lg: a choice in a sheet, sized for a thumb; md: a compact row such as an account trigger. */
  size?: "md" | "lg";
}

export function RowButton({
  size = "lg",
  type = "button",
  className,
  children,
  ...props
}: RowButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "flex w-full min-w-0 items-center gap-3 rounded-md text-left text-ink outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus aria-[current]:bg-surface-2 data-[state=open]:bg-surface-2",
        size === "lg" ? "min-h-14 px-2" : "gap-2.5 p-1.5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
