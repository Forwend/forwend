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

// A round icon action with its label underneath, as on a money dashboard. A disabled action keeps its place, says why
// in its accessible name, and still reports a press to onClick, so the page can show the reason on touch too.
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
        "group flex min-w-16 flex-col items-center gap-2 text-sm text-ink outline-none aria-disabled:cursor-not-allowed aria-disabled:text-subtle",
        className,
      )}
      {...props}
    >
      <span
        className={cx(
          "grid size-12 place-items-center rounded-pill border transition-[background-color,border-color,color,opacity] duration-[var(--fw-duration-fast)] ease-out group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus",
          primary && !disabled
            ? "border-primary bg-primary text-on-primary group-hover:opacity-90"
            : "border-line bg-surface group-hover:bg-surface-2 group-aria-disabled:bg-surface-2",
        )}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      {label}
      {disabled ? <span className="sr-only">: {disabledReason}</span> : null}
    </button>
  );
}
