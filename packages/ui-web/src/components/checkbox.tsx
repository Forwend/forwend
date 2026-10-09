"use client";

import { useId } from "react";
import { cx } from "../lib/cx";
import type { CheckboxProps } from "../types/ui/fields";

export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <label
      htmlFor={fieldId}
      className={cx("inline-flex cursor-pointer items-center gap-2.5 text-sm", className)}
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
