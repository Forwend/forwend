"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";
import { cx } from "../../lib/cx";
import { BUTTON_SIZES, Button } from "../buttons/button";

export const CAPTURE_STATUS = {
  idle: "idle",
  submitting: "submitting",
  success: "success",
  error: "error",
} as const;

export type CaptureStatus = (typeof CAPTURE_STATUS)[keyof typeof CAPTURE_STATUS];

export interface EmailCaptureProps {
  status: CaptureStatus;
  /** The error text (shown under the pill) or the confirmation (shown inside the pill). */
  message?: string;
  onSubmit: (email: string) => void;
  submitLabel: string;
  /** Visually hidden label for the email field. */
  label?: string;
  placeholder?: string;
}

// One pill, one fixed height, for every state: the control never jumps and never shows a
// greyed-out button. 13.5 = 1px border + 6px padding + 40px button + 6px padding + 1px border.
const PILL = "flex h-13.5 w-full items-center gap-2 rounded-pill border bg-surface p-1.5 shadow-md";

export function EmailCapture({
  status,
  message,
  onSubmit,
  submitLabel,
  label = "Email address",
  placeholder = "you@example.com",
}: EmailCaptureProps) {
  const id = useId();
  const [email, setEmail] = useState("");
  // The error belongs to the submitted address; it clears as soon as the user edits it.
  const [submitted, setSubmitted] = useState("");
  const isError = status === CAPTURE_STATUS.error && email === submitted;
  const isSuccess = status === CAPTURE_STATUS.success;

  return (
    <div className="w-full max-w-md">
      {/* Stays mounted in every state, so screen readers announce the error or the confirmation. */}
      <p aria-live="polite" className="sr-only">
        {isSuccess || isError ? message : ""}
      </p>
      {isSuccess ? (
        <div data-capture="confirmation" className={cx(PILL, "border-line pr-5 pl-2")}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-success-soft text-success">
            <Check aria-hidden className="size-[var(--fw-icon-md)]" strokeWidth={2.25} />
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-medium text-ink">{message}</span>
            {email ? <span className="truncate text-sm text-muted">{email}</span> : null}
          </span>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(email);
            onSubmit(email);
          }}
        >
          <div
            className={cx(
              PILL,
              "pl-5 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] focus-within:border-ink focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--fw-ink)_12%,transparent)]",
              isError ? "border-danger" : "border-line-strong",
            )}
          >
            <label htmlFor={id} className="sr-only">
              {label}
            </label>
            <input
              id={id}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={placeholder}
              aria-invalid={isError || undefined}
              aria-describedby={isError && message ? `${id}-error` : undefined}
              className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none autofill:shadow-[inset_0_0_0_10rem_var(--fw-surface)] autofill:[-webkit-text-fill-color:var(--fw-ink)]"
            />
            <Button
              type="submit"
              size={BUTTON_SIZES.md}
              loading={status === CAPTURE_STATUS.submitting}
              className="shrink-0"
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
      {/* Fixed-height row under the pill for the error, so content below never moves. */}
      <div className="mt-2 flex min-h-7 justify-center">
        {isError && message ? (
          <p
            id={`${id}-error`}
            className="rounded-pill bg-surface px-3 py-1 text-sm text-danger shadow-sm"
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
