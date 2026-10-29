"use client";

import { type ComponentPropsWithoutRef, useEffect, useId, useRef } from "react";
import { cx } from "../../lib/cx";

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<"input">, "type"> {
  label: string;
  /** The label for screen readers only, where the row around the box already says what it is. */
  hideLabel?: boolean;
  /** Some of what it stands for is checked: drawn as a dash, read as "mixed". */
  mixed?: boolean;
}

export function Checkbox({
  label,
  hideLabel,
  mixed = false,
  id,
  className,
  ...props
}: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const box = useRef<HTMLInputElement>(null);
  // Mixed is a property, not an attribute: only script can set it.
  useEffect(() => {
    if (box.current) box.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label
      htmlFor={fieldId}
      className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm", className)}
    >
      <input
        ref={box}
        id={fieldId}
        type="checkbox"
        className="size-[var(--fw-icon-md)] shrink-0 rounded-sm accent-[var(--fw-accent)]"
        {...props}
      />
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </label>
  );
}
