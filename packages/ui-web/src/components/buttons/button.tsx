import { Loader2 } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../lib/cx";

export const BUTTON_VARIANTS = {
  primary: "primary",
  secondary: "secondary",
  ghost: "ghost",
  link: "link",
  /** A feature that keeps its place until it is built: dashed and quiet; pair it with aria-disabled. */
  soon: "soon",
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
  soon: "cursor-not-allowed border border-dashed border-line-strong text-subtle",
};

const SIZES: Record<ButtonSize, string> = {
  // The pseudo elements stretch the hit area to 44px without changing the look.
  sm: "relative h-8 px-3.5 text-sm before:absolute before:inset-x-0 before:-inset-y-1.5",
  md: "relative h-10 px-5 text-sm before:absolute before:inset-x-0 before:-inset-y-0.5",
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
  // Loading keeps the button's own colors and ignores clicks; disabled greys it out. While loading only the spinner
  // shows: the label stays in place, transparent, so the width holds and screen readers keep the button's name.
  return (
    <button
      type={type}
      data-variant={variant ?? BUTTON_VARIANTS.primary}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      className={cx(
        buttonClasses({ variant, size }),
        loading && "relative cursor-progress",
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <Loader2
            aria-hidden
            data-motion="essential"
            className="absolute inset-0 m-auto size-[var(--fw-icon-sm)] animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]"
          />
          <span data-loading-label className="inline-flex items-center gap-2 opacity-0">
            {children}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
