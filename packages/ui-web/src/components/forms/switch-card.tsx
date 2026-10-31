"use client";

import { type ReactNode, useId } from "react";
import { cx } from "../../lib/cx";
import { SwitchTrack } from "./switch";

export interface SwitchCardProps {
  title: string;
  description?: string;
  /** A small icon on a tile before the title. */
  icon?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** What the switch opens: inside the card under the title, sliding open while on and inert while off. */
  children?: ReactNode;
  className?: string;
}

/** A setting as a card: what it does on the left, the switch at the row's end and, while on, the field it opens. */
export function SwitchCard({
  title,
  description,
  icon,
  checked,
  onCheckedChange,
  disabled,
  children,
  className,
}: SwitchCardProps) {
  const id = useId();
  return (
    <div className={cx("rounded-lg border border-line bg-surface", className)}>
      <div className="flex items-center gap-3 px-4 py-3">
        {icon ? (
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 text-muted [&_svg]:size-[var(--fw-icon-md)]"
          >
            {icon}
          </span>
        ) : null}
        {/* The whole text flips the switch, as a label does. */}
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span id={`${id}-title`} className="block text-sm font-medium text-ink">
            {title}
          </span>
          {description ? (
            <span id={`${id}-description`} className="block text-sm text-muted">
              {description}
            </span>
          ) : null}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className="inline-flex min-h-11 shrink-0 items-center rounded-pill disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SwitchTrack checked={checked} />
        </button>
      </div>
      {children ? (
        // Grid rows animate the height to the content's own; the field stays mounted so closing slides too.
        <div
          inert={!checked}
          className={cx(
            "grid transition-[grid-template-rows,opacity] duration-[var(--fw-duration-base)] ease-out motion-reduce:transition-none",
            checked ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className={cx("px-4 pb-4", icon ? "sm:pl-16" : "")}>
              <div className="rounded-md bg-surface-2 px-3 py-3">{children}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
