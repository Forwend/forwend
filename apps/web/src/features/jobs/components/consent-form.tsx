"use client";

import { Button, Form, TextField } from "@forwend/ui-web";
import { type FormEvent, useState } from "react";
import { flushSync } from "react-dom";
import { ACCEPT_FIELDS } from "@/features/jobs/constants/jobs";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { namedField } from "@/features/jobs/lib/jobs";
import type { AcceptField } from "@/features/jobs/types/jobs";
import { EMAIL_PATTERN } from "@/shared/constants/email";

const NOT_FOUND = 404;
const INVALID_VALUE = 422;
const TOO_MANY = 429;

export interface ConsentFormProps {
  text: string;
  action: string;
  /** A rejection is the API's failure. */
  onConsent: (name: string, email: string) => Promise<void>;
  loading: boolean;
  /** Said when the API answers 404, unless onConsent handles it. */
  notFound?: string;
  compact?: boolean;
  className?: string;
  "aria-label"?: string;
}

// The consent a quote (R-102) and each scope change (R-106) are accepted with.
export function ConsentForm({
  text,
  action,
  onConsent,
  loading,
  notFound,
  compact = false,
  className,
  "aria-label": label,
}: ConsentFormProps) {
  const [errors, setErrors] = useState<Partial<Record<AcceptField, string>>>({});
  const [formError, setFormError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const shown: Partial<Record<AcceptField, string>> = {};
    if (!name) shown.name = COPY.errors.required;
    if (!EMAIL_PATTERN.test(email)) shown.email = COPY.errors.email;
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    try {
      await onConsent(name, email);
    } catch (error) {
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field = namedField(failure.data?.error?.message ?? "", Object.values(ACCEPT_FIELDS));
      if (failure.status === INVALID_VALUE && field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else
        setFormError(
          failure.status === NOT_FOUND && notFound
            ? notFound
            : failure.status === TOO_MANY
              ? COPY.errors.tooMany
              : COPY.errors.failed,
        );
    }
  };

  return (
    <Form onSubmit={submit} aria-label={label} className={className}>
      <p className="text-sm text-muted">{text}</p>
      <div className={`grid sm:grid-cols-2 ${compact ? "gap-4" : "gap-5"}`}>
        <TextField
          label={COPY.accept.name}
          name="name"
          autoComplete="name"
          maxLength={200}
          error={errors.name}
        />
        <TextField
          type="email"
          label={COPY.accept.email}
          name="email"
          autoComplete="email"
          maxLength={254}
          error={errors.email}
        />
      </div>
      <Button
        type="submit"
        size={compact ? "sm" : undefined}
        loading={loading}
        className="self-start"
      >
        {action}
      </Button>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
