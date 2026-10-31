"use client";

import { type ComponentPropsWithoutRef, type ReactNode, useId } from "react";
import { cx } from "../../lib/cx";
import { FIELD_CONTROL_CLASSES } from "./field-classes";

export interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
  /** A button that acts on the value, on the input's row: the hint and error stay under both. */
  action?: ReactNode;
  /** A setting's short value: the label and its line on the left, a narrow input at the row's end. */
  inline?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  action,
  inline = false,
  id,
  className,
  ...props
}: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const line = error ? (
    <p id={`${fieldId}-error`} role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : hint ? (
    <p id={`${fieldId}-hint`} className="text-sm text-muted">
      {hint}
    </p>
  ) : null;
  if (inline) {
    return (
      <div className={cx("flex items-center justify-between gap-4", className)}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={fieldId} className="text-sm font-medium text-ink">
            {label}
          </label>
          {line}
        </div>
        {/* The control classes set w-full, so the box sets the width. */}
        <div className="w-32 shrink-0">
          <input
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={FIELD_CONTROL_CLASSES}
            {...props}
          />
        </div>
      </div>
    );
  }
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      {action ? (
        // The action (a pill button) takes the field's height, so the two read as one row.
        <div className="flex items-center gap-2 [&>*]:h-10 pointer-coarse:[&>*]:h-11">
          <input
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cx(FIELD_CONTROL_CLASSES, "min-w-0 flex-1")}
            {...props}
          />
          {action}
        </div>
      ) : (
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={FIELD_CONTROL_CLASSES}
          {...props}
        />
      )}
      {line}
    </div>
  );
}
