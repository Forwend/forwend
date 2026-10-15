import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/cx";

export const ICON_BUTTON_SIZES = {
  xs: "xs",
  sm: "sm",
  md: "md",
} as const;

export type IconButtonSize = (typeof ICON_BUTTON_SIZES)[keyof typeof ICON_BUTTON_SIZES];

export interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  /** The accessible name: an icon alone says nothing to a screen reader. */
  label: string;
  size?: IconButtonSize;
}

// xs sits inline with text (a hint); sm and md are toolbar buttons. Each reaches a 44px hit area through a pseudo
// element without changing its look.
const SIZES: Record<IconButtonSize, string> = {
  xs: "size-6 rounded-sm text-subtle before:-inset-2.5",
  sm: "size-8 rounded-md text-muted hover:bg-surface-2 before:-inset-1.5",
  md: "size-10 rounded-md text-muted hover:bg-surface-2 before:-inset-0.5",
};

/** A button that shows only an icon (or an avatar); the label names it. */
export function IconButton({
  label,
  size = ICON_BUTTON_SIZES.sm,
  type = "button",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        "relative grid shrink-0 place-items-center outline-none transition-colors duration-[var(--fw-duration-fast)] before:absolute hover:text-ink focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-surface-2",
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
