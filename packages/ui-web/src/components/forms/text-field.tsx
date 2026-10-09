"use client";

import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "../../lib/cx";
import { FIELD_CONTROL_CLASSES } from "./field-classes";

export interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, id, className, ...props }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={FIELD_CONTROL_CLASSES}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
