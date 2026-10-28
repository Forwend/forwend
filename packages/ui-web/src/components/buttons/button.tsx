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
  /** Confirms an action that can't be undone, such as canceling an invoice. */
  danger: "danger",
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

// On touch screens the pseudo element stretches the hit area to 44px without changing the look.
const BASE =
  "relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,scale] duration-[var(--fw-duration-fast)] ease-[var(--fw-ease-out)] before:absolute before:inset-x-0 active:scale-[0.98] aria-disabled:active:scale-100 motion-reduce:active:scale-100 disabled:border-line disabled:bg-surface-2 disabled:text-subtle disabled:shadow-none disabled:active:scale-100";

// Primary is the lime fill, kept for a view's main action; its inset edge holds the shape on white. The rest stay
// neutral and flat, so one lime action per view leads.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand font-semibold text-on-brand shadow-[inset_0_0_0_1px_var(--fw-brand-edge)] hover:bg-brand-hover",
  secondary:
    "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2 dark:border-line-strong",
  ghost: "text-ink hover:bg-surface-2 active:bg-surface-2",
  link: "text-ink underline decoration-line-strong decoration-1 underline-offset-4 hover:decoration-ink pointer-coarse:before:-inset-y-3",
  soon: "cursor-not-allowed border border-dashed border-line-strong text-subtle",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-soft",
};

// The touch area is a 44px band centered on the button, not an inset: an inset counts from inside the border, so a
// bordered button would fall 2px short.
const TOUCH =
  "pointer-coarse:before:top-1/2 pointer-coarse:before:h-11 pointer-coarse:before:-translate-y-1/2";

// One height scale for every control: 32px in dense rows, 40px by default and in toolbars, 48px for a main action.
const SIZES: Record<ButtonSize, string> = {
  sm: `h-8 px-3 text-sm ${TOUCH}`,
  md: `h-10 px-4 text-sm ${TOUCH}`,
  lg: "h-12 px-5 text-base",
};

export function buttonClasses({
  variant = BUTTON_VARIANTS.primary,
  size = BUTTON_SIZES.md,
}: ButtonStyleOptions = {}): string {
  return cx(
    BASE,
    VARIANTS[variant],
    variant === BUTTON_VARIANTS.link ? "rounded-sm px-0" : cx("rounded-md", SIZES[size]),
  );
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
  // While loading the label stays in place, transparent, so the width holds and screen readers keep the name.
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
