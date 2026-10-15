"use client";

import { useId } from "react";
import { cx } from "../../lib/cx";

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset
      className={cx(
        "m-0 inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="relative grid h-8 cursor-pointer place-items-center rounded-sm px-3 text-xs font-medium text-muted transition-colors duration-[var(--fw-duration-fast)] before:absolute before:inset-x-0 before:-inset-y-1.5 hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-focus"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onValueChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
