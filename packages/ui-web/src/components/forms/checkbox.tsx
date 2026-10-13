"use client";

import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "../../lib/cx";

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<"input">, "type"> {
  label: string;
}

export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <label
      htmlFor={fieldId}
      className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm", className)}
    >
      <input
        id={fieldId}
        type="checkbox"
        className="size-[var(--fw-icon-md)] rounded-sm accent-[var(--fw-accent)]"
        {...props}
      />
      {label}
    </label>
  );
}
