"use client";

import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "../../lib/cx";

export interface AmountFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  /** The currency or token, inside the field at its end. */
  unit: string;
  hint?: string;
  error?: string;
}

/** An amount someone checks at a glance, such as a sale's total: large figures, with the unit inside the field. */
export function AmountField({
  label,
  unit,
  hint,
  error,
  id,
  className,
  ...props
}: AmountFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const line = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : null;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div
        className={cx(
          "flex h-14 items-center gap-2 rounded-md border bg-surface px-4 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out focus-within:border-field-focus focus-within:ring-2 focus-within:ring-field-ring",
          error ? "border-danger" : "border-field",
        )}
      >
        <input
          id={fieldId}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${fieldId}-unit`, line].filter(Boolean).join(" ")}
          className="min-w-0 flex-1 bg-transparent text-3xl font-medium tracking-tight text-ink tabular-nums outline-none placeholder:text-subtle"
          {...props}
        />
        <span id={`${fieldId}-unit`} className="text-base text-muted">
          {unit}
        </span>
      </div>
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
