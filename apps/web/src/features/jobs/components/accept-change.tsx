"use client";

import { Button, Form, TextField } from "@forwend/ui-web";
import { type FormEvent, useState } from "react";
import { flushSync } from "react-dom";
import { useAcceptChangeMutation } from "@/features/jobs/api/jobs-api";
import { ACCEPT_FIELDS, EMAIL_PATTERN } from "@/features/jobs/constants/jobs";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { namedField } from "@/features/jobs/lib/jobs";
import type { AcceptField, JobPayment } from "@/features/jobs/types/jobs";

const NOT_FOUND = 404;
const INVALID_VALUE = 422;
const TOO_MANY = 429;

export interface AcceptChangeProps {
  token: string;
  change: JobPayment;
  /** Called once accepted: the form goes, so the page moves focus to the change. */
  onAccepted: (position: number) => void;
}

// R-106: the client's accept of a scope change on the quote page, with their typed name and email like the quote's.
// It sends the change's proposedAt exactly as read, so the consent names this change and no other (R-105).
export function AcceptChange({ token, change, onAccepted }: AcceptChangeProps) {
  const [accept, { isLoading }] = useAcceptChangeMutation();
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
    if (Object.keys(shown).length > 0 || !change.proposedAt) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    try {
      await accept({
        token,
        position: change.position,
        proposedAt: change.proposedAt,
        name,
        email,
      }).unwrap();
      onAccepted(change.position);
    } catch (error) {
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field = namedField(failure.data?.error?.message ?? "", Object.values(ACCEPT_FIELDS));
      if (failure.status === INVALID_VALUE && field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else
        setFormError(
          failure.status === NOT_FOUND
            ? COPY.change.gone
            : failure.status === TOO_MANY
              ? COPY.errors.tooMany
              : COPY.errors.failed,
        );
    }
  };

  return (
    <Form
      onSubmit={submit}
      aria-label={COPY.change.title(change.title)}
      className="mt-2 rounded-md border border-line p-3"
    >
      <p className="text-sm text-muted">{COPY.change.text}</p>
      <div className="grid gap-4 sm:grid-cols-2">
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
      <Button type="submit" size="sm" loading={isLoading} className="self-start">
        {COPY.change.action}
      </Button>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {formError}
      </p>
    </Form>
  );
}
