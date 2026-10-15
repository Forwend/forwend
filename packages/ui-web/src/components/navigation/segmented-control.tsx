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

// Native radios in a recessed track; the chosen one is a raised segment (lighter than the track in both themes). With
// room, every segment is as wide as the widest label and a wider track is shared equally; short of room, a segment
// shrinks to its own label, and only then does the track scroll sideways, fading at the edge that has more. The track
// clips anything outside it, so on touch screens it grows to 44px itself and each segment's hit area reaches into its
// padding and the gaps: every point of the track picks a segment.
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
        "fw-scroll-fade m-0 inline-grid min-w-0 max-w-full auto-cols-[minmax(max-content,1fr)] grid-flow-col items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-pill bg-surface-2 [scrollbar-width:none] pointer-coarse:h-11 pointer-coarse:p-0.5",
        size === "sm" ? "h-8 p-0.5" : "h-10 p-1",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            "relative grid cursor-pointer place-items-center whitespace-nowrap rounded-pill text-sm font-medium text-muted transition-[background-color,color,box-shadow] duration-[var(--fw-duration-fast)] hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus dark:has-checked:bg-[color-mix(in_oklab,var(--fw-ink)_12%,var(--fw-surface-2))]",
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
