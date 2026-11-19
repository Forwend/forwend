"use client";

import { type ComponentPropsWithoutRef, useId } from "react";
import { cx } from "../../lib/cx";
import { FieldMessage, fieldMessageId } from "./field-message";

export interface AmountFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  unit: string;
  hint?: string;
  error?: string;
  bare?: boolean;
}

/** An amount checked at a glance: large figures, with the unit inside the field. */
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
  const describedBy = [`${fieldId}-unit`, fieldMessageId(fieldId, error, hint)]
    .filter(Boolean)
    .join(" ");
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
            aria-describedby={describedBy}
            // As wide as its tabular figures (1ch each) in every browser; size alone varies by browser.
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
        <FieldMessage fieldId={fieldId} error={error} hint={hint} className="text-center" />
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
          aria-describedby={describedBy}
          className="min-w-0 flex-1 bg-transparent text-3xl font-medium tracking-tight text-ink tabular-nums outline-none placeholder:text-subtle"
          {...props}
        />
        <span id={`${fieldId}-unit`} className="text-base text-muted">
          {unit}
        </span>
      </div>
      <FieldMessage fieldId={fieldId} error={error} hint={hint} />
    </div>
  );
}
