"use client";

import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "../../lib/cx";

export interface AmountFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  /** The currency or token, inside the field at its end. */
  unit: string;
  hint?: string;
  error?: string;
  /** A send's amount: the figure large and centered with its unit beside it, no box; the label is for screen readers.
   * Long amounts step the size down so they stay on one line. */
  bare?: boolean;
}

/** An amount someone checks at a glance, such as a sale's total: large figures, with the unit inside the field. */
export function AmountField({
  label,
  unit,
  hint,
  error,
  bare = false,
  id,
  className,
  ...props
}: AmountFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const line = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : null;
  if (bare) {
    const shown = String(props.value || props.defaultValue || props.placeholder || "0");
    const length = shown.length;
    const size = length > 14 ? "text-3xl" : length > 9 ? "text-4xl" : "text-6xl";
    return (
      <div className={cx("flex flex-col items-center gap-2", className)}>
        <label htmlFor={fieldId} className="sr-only">
          {label}
        </label>
        <div className="flex max-w-full items-baseline justify-center gap-2">
          <input
            id={fieldId}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={[`${fieldId}-unit`, line].filter(Boolean).join(" ")}
            // As wide as its figures (tabular, so a ch each, the point narrower), in every browser. The figures sit at
            // the field's end, so the room the point leaves falls outside them, not between them and the unit.
            style={{ width: `${Math.max(length, 1) + 0.5}ch` }}
            className={cx(
              "max-w-full bg-transparent text-right font-medium tracking-tight tabular-nums outline-none transition-[font-size] duration-[var(--fw-duration-fast)] ease-out placeholder:text-subtle motion-reduce:transition-none",
              size,
              error ? "text-danger" : "text-ink",
            )}
            {...props}
          />
          <span id={`${fieldId}-unit`} className="text-2xl font-medium text-muted">
            {unit}
          </span>
        </div>
        {error ? (
          <p id={`${fieldId}-error`} role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={`${fieldId}-hint`} className="text-center text-sm text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
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
