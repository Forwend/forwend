"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";
import { BUTTON_SIZES } from "../constants/button";
import { CAPTURE_STATUS } from "../constants/email-capture";
import { cx } from "../lib/cx";
import type { EmailCaptureProps } from "../types/ui/email-capture";
import { Button } from "./button";

// One pill for every state, so the control never jumps and never shows a greyed-out button.
const PILL =
  "flex min-h-[3.25rem] w-full items-center gap-2 rounded-pill border bg-surface p-1.5 shadow-md";

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
  const isError = status === CAPTURE_STATUS.error;

  if (status === CAPTURE_STATUS.success) {
    return (
      <div className="w-full max-w-md">
        <div role="status" className={cx(PILL, "border-line pr-5 pl-2")}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-success-soft text-success">
            <Check aria-hidden className="size-[var(--fw-icon-md)]" strokeWidth={2.25} />
          </span>
          <span className="min-w-0 text-left">
            <span className="block font-medium text-ink">{message}</span>
            {email ? <span className="block truncate text-sm text-muted">{email}</span> : null}
          </span>
        </div>
        {/* Same height as the form's message row, so the content below does not move. */}
        <div aria-hidden className="mt-2 min-h-7" />
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(email);
      }}
      className="w-full max-w-md"
    >
      <div
        className={cx(
          PILL,
          "pl-5 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] focus-within:ring-4 focus-within:ring-[color-mix(in_oklab,var(--fw-focus)_22%,transparent)]",
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
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={placeholder}
          aria-invalid={isError || undefined}
          aria-describedby={message ? `${id}-message` : undefined}
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
      <div id={`${id}-message`} aria-live="polite" className="mt-2 flex min-h-7 justify-center">
        {message ? (
          <p className="rounded-pill bg-surface px-3 py-1 text-sm text-danger shadow-sm">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
