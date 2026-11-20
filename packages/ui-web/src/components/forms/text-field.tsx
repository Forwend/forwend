"use client";

import { type ComponentPropsWithoutRef, type ReactNode, useId } from "react";
import { cx } from "../../lib/cx";
import {
  FIELD_BARE_INPUT_CLASSES,
  FIELD_CONTROL_CLASSES,
  FIELD_FRAME_CLASSES,
} from "./field-classes";
import { FieldMessage, fieldMessageId } from "./field-message";

export interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
  action?: ReactNode;
  end?: ReactNode;
  labelHidden?: boolean;
  inputClassName?: string;
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
  const describedBy = fieldMessageId(fieldId, error, hint);
  const line = <FieldMessage fieldId={fieldId} error={error} hint={hint} />;
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
