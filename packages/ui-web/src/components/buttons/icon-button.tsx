import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/cx";

const ICON_BUTTON_SIZES = {
  xs: "xs",
  sm: "sm",
  md: "md",
} as const;

export type IconButtonSize = (typeof ICON_BUTTON_SIZES)[keyof typeof ICON_BUTTON_SIZES];

export interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  label: string;
  size?: IconButtonSize;
}

// Button's heights; a pseudo element reaches a 44px hit area (xs always, the others on touch).
const SIZES: Record<IconButtonSize, string> = {
  xs: "size-6 text-subtle before:-inset-2.5",
  sm: "size-8 text-muted pointer-coarse:before:-inset-1.5",
  md: "size-10 text-muted pointer-coarse:before:-inset-0.5",
};

// The tint mixes ink into whatever lies beneath, so it reads the same on any surface.
const BASE =
  "relative grid shrink-0 place-items-center rounded-md outline-none transition-colors duration-[var(--fw-duration-fast)] before:absolute not-disabled:hover:bg-[color-mix(in_oklab,var(--fw-ink)_7%,transparent)] not-disabled:hover:text-ink not-disabled:active:bg-[color-mix(in_oklab,var(--fw-ink)_12%,transparent)] not-disabled:active:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-[color-mix(in_oklab,var(--fw-ink)_7%,transparent)] data-[state=open]:text-ink";

/** IconButton's look for a link that acts as one, such as Open in a new tab. */
export function iconButtonClasses(size: IconButtonSize = ICON_BUTTON_SIZES.sm) {
  return cx(BASE, SIZES[size]);
}

export function IconButton({
  label,
  size = ICON_BUTTON_SIZES.sm,
  type = "button",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={cx(BASE, SIZES[size], className)} {...props}>
      {children}
    </button>
  );
}
