import type { ComponentPropsWithoutRef, ComponentType } from "react";
import { cx } from "../../lib/cx";

export interface ActionButtonProps extends ComponentPropsWithoutRef<"button"> {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  /** Set when the action is not available yet; shown as the reason and the button does nothing. */
  disabledReason?: string;
  /** The page's main action: filled. */
  primary?: boolean;
}

// A disabled action still reports a press to onClick, so the page can show the reason on touch too.
export function ActionButton({
  icon: Icon,
  label,
  disabledReason,
  primary,
  className,
  ...props
}: ActionButtonProps) {
  const disabled = Boolean(disabledReason);
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      className={cx(
        "group flex min-w-0 flex-col items-center gap-2 text-xs text-ink outline-none sm:min-w-16 sm:text-sm aria-disabled:cursor-not-allowed aria-disabled:text-subtle",
        className,
      )}
      {...props}
    >
      <span
        className={cx(
          "grid size-12 place-items-center rounded-pill border shadow-sm transition-[background-color,border-color,color,opacity,scale] duration-[var(--fw-duration-fast)] ease-[var(--fw-ease-out)] group-active:scale-95 group-aria-disabled:group-active:scale-100 motion-reduce:group-active:scale-100 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus",
          primary && !disabled
            ? "border-primary bg-primary text-on-primary group-hover:opacity-90"
            : "border-line bg-surface group-hover:bg-surface-2 group-aria-disabled:bg-surface-2 group-aria-disabled:shadow-none",
        )}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      {label}
      {disabled ? <span className="sr-only">: {disabledReason}</span> : null}
    </button>
  );
}
