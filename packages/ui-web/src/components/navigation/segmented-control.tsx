"use client";

import { useId } from "react";
import { cx } from "../../lib/cx";

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  /** md (40px) in toolbars and forms; sm (32px) beside a chart or in a panel's header. Both are 44px on touch. */
  size?: "sm" | "md";
  className?: string;
}

// The track clips anything outside it, so on touch screens the track itself grows to 44px and each segment's hit
// area reaches into the padding and gaps: every point of the track picks a segment.
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset
      className={cx(
        "fw-scroll-fade m-0 inline-grid min-w-0 max-w-full auto-cols-[minmax(max-content,1fr)] grid-flow-col items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-md bg-surface-2 [scrollbar-width:none] pointer-coarse:h-11 pointer-coarse:p-0.5",
        size === "sm" ? "h-8 p-0.5" : "h-10 p-1",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            "relative grid cursor-pointer place-items-center whitespace-nowrap rounded-sm text-sm font-medium text-muted transition-[background-color,color,box-shadow] duration-[var(--fw-duration-fast)] hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus dark:has-checked:bg-[color-mix(in_oklab,var(--fw-ink)_12%,var(--fw-surface-2))]",
            size === "sm" ? "h-7 px-2.5" : "h-8 px-2 sm:px-3",
            "pointer-coarse:h-10 pointer-coarse:before:absolute pointer-coarse:before:-inset-x-px pointer-coarse:before:-inset-y-0.5",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onValueChange(option.value)}
            className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
