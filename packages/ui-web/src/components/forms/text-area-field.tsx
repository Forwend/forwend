"use client";

import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "../../lib/cx";
import { FIELD_CONTROL_CLASSES } from "./field-classes";
import { FieldMessage, fieldMessageId } from "./field-message";

export interface TextAreaFieldProps extends ComponentPropsWithoutRef<"textarea"> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextAreaField({ label, hint, error, id, className, ...props }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = fieldMessageId(fieldId, error, hint);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(FIELD_CONTROL_CLASSES, "h-auto resize-y py-2.5")}
        {...props}
      />
      <FieldMessage fieldId={fieldId} error={error} hint={hint} />
    </div>
  );
}
