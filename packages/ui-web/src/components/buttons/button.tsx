import { Loader2 } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../lib/cx";

export const BUTTON_VARIANTS = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  link: "link",
} as const;

export const BUTTON_SIZES = {
  sm: "sm",
  md: "md",
  lg: "lg",
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[keyof typeof BUTTON_VARIANTS];

export type ButtonSize = (typeof BUTTON_SIZES)[keyof typeof BUTTON_SIZES];

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export interface ButtonProps extends ComponentPropsWithoutRef<"button">, ButtonStyleOptions {
  loading?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-pill font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-[var(--fw-duration-fast)] ease-out disabled:border-line disabled:bg-surface-2 disabled:text-subtle disabled:shadow-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary shadow-md hover:bg-[color-mix(in_oklab,var(--fw-primary)_86%,var(--fw-bg))]",
  secondary: "border border-line-strong bg-surface text-ink shadow-sm hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  link: "text-accent underline decoration-1 underline-offset-4 hover:decoration-2",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

/** Classes for anything that should look like a button, such as a link. */
export function buttonClasses({
  variant = BUTTON_VARIANTS.primary,
  size = BUTTON_SIZES.md,
}: ButtonStyleOptions = {}): string {
  return cx(BASE, VARIANTS[variant], variant === BUTTON_VARIANTS.link ? "px-0" : SIZES[size]);
}

export function Button({
  variant,
  size,
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  // Loading keeps the button's own colors (with a spinner) and ignores clicks; disabled greys it out.
  return (
    <button
      type={type}
      data-variant={variant ?? BUTTON_VARIANTS.primary}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      className={cx(buttonClasses({ variant, size }), loading && "cursor-progress", className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-[var(--fw-icon-sm)] animate-spin" /> : null}
      {children}
    </button>
  );
}
