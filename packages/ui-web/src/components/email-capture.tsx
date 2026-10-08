"use client";

import { useId, useState } from "react";
import { BUTTON_SIZES } from "../constants/button";
import { CAPTURE_STATUS } from "../constants/email-capture";
import { cx } from "../lib/cx";
import type { EmailCaptureProps } from "../types/ui/email-capture";
import { Button } from "./button";

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
  const isSuccess = status === CAPTURE_STATUS.success;

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
          "flex items-center gap-1.5 rounded-pill border bg-surface p-1.5 pl-5 shadow-md transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] focus-within:ring-4 focus-within:ring-[color-mix(in_oklab,var(--fw-focus)_22%,transparent)]",
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
          disabled={isSuccess}
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
        />
        <Button
          type="submit"
          size={BUTTON_SIZES.md}
          loading={status === CAPTURE_STATUS.submitting}
          disabled={isSuccess}
        >
          {submitLabel}
        </Button>
      </div>
      <p
        id={`${id}-message`}
        aria-live="polite"
        className={cx("mt-2 min-h-5 pl-5 text-sm", isError ? "text-danger" : "text-success")}
      >
        {message}
      </p>
    </form>
  );
}
