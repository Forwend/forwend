import { Loader2 } from "lucide-react";
import { BUTTON_SIZES, BUTTON_VARIANTS } from "../constants/button";
import { cx } from "../lib/cx";
import type {
  ButtonProps,
  ButtonSize,
  ButtonStyleOptions,
  ButtonVariant,
} from "../types/ui/button";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-pill font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-[var(--fw-duration-fast)] ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

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
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant ?? BUTTON_VARIANTS.primary}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClasses({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-[var(--fw-icon-sm)] animate-spin" /> : null}
      {children}
    </button>
  );
}
