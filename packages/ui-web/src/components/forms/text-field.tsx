"use client";

import { type ComponentPropsWithoutRef, type ReactNode, useId } from "react";
import { cx } from "../../lib/cx";
import {
  FIELD_BARE_INPUT_CLASSES,
  FIELD_CONTROL_CLASSES,
  FIELD_FRAME_CLASSES,
} from "./field-classes";

export interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
  /** A button that acts on the value, on the input's row: the hint and error stay under both. */
  action?: ReactNode;
  /** A small control inside the field, at its end, such as Paste or Clear; it stays out of the field's name. */
  end?: ReactNode;
  /** The label is for screen readers only, where a heading right above already names the field. */
  labelHidden?: boolean;
  /** Classes for the input alone, such as font-mono for an address, so the label and hint keep the body font. */
  inputClassName?: string;
  /** A setting's short value: the label and its line on the left, a narrow input at the row's end. */
  inline?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  action,
  end,
  labelHidden = false,
  inputClassName,
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
      <label htmlFor={fieldId} className={labelHidden ? "sr-only" : "text-sm font-medium text-ink"}>
        {label}
      </label>
      {end ? (
        <div className={FIELD_FRAME_CLASSES}>
          <input
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cx(FIELD_BARE_INPUT_CLASSES, inputClassName)}
            {...props}
          />
          <div className="flex shrink-0 items-center">{end}</div>
        </div>
      ) : action ? (
        // The action (a pill button) takes the field's height, so the two read as one row.
        <div className="flex items-center gap-2 [&>*]:h-10 pointer-coarse:[&>*]:h-11">
          <input
            id={fieldId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cx(FIELD_CONTROL_CLASSES, "min-w-0 flex-1", inputClassName)}
            {...props}
          />
          {action}
        </div>
      ) : (
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(FIELD_CONTROL_CLASSES, inputClassName)}
          {...props}
        />
      )}
      {line}
    </div>
  );
}
