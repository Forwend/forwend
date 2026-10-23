"use client";

import { useId, useState } from "react";
import { cx } from "../../lib/cx";

export interface CodeInputProps {
  label: string;
  value: string;
  onValueChange: (digits: string) => void;
  length?: number;
  hint?: string;
  error?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

// One real input sits over the boxes, so paste, one-time-code autofill and screen readers work as in any text field.
// Non-digits are dropped, so a pasted "Code: 123456" works; maxLength would cut the paste first.
export function CodeInput({
  label,
  value,
  onValueChange,
  length = 6,
  hint,
  error,
  id,
  name,
  disabled,
  autoFocus,
  className,
}: CodeInputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [focused, setFocused] = useState(false);
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const active = Math.min(value.length, length - 1);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative flex gap-2">
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          const current = focused && i === active && !disabled;
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: one box per position, the order never changes
              key={i}
              aria-hidden
              className={cx(
                "grid h-12 flex-1 place-items-center rounded-md border bg-surface font-mono text-xl tabular-nums transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out",
                disabled
                  ? "border-line text-subtle"
                  : cx(
                      "text-ink",
                      error ? "border-danger" : current ? "border-field-focus" : "border-field",
                    ),
                current && "ring-2 ring-field-ring",
              )}
            >
              {digit ??
                (current ? <span className="h-5 w-px bg-ink motion-safe:animate-pulse" /> : null)}
            </span>
          );
        })}
        <input
          id={fieldId}
          name={name}
          value={value}
          onChange={(event) =>
            onValueChange(event.target.value.replace(/\D/g, "").slice(0, length))
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`\\d{${length}}`}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: the caller decides; used when the code is the only next step
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="absolute inset-0 h-full w-full cursor-text bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
        />
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
