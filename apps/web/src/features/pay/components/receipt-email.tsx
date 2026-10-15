"use client";

import { Button, TextField } from "@forwend/ui-web";
import { type FormEvent, useState } from "react";
import { useSetPayerEmailMutation } from "@/features/invoices/api/invoices-api";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";

const COPY = PAY_COPY.receipt;
const ANSWERS = { 409: COPY.sent, 422: COPY.invalid, 429: COPY.tooMany } as const;

export interface ReceiptEmailProps {
  invoiceId: string;
  paid: boolean;
}

// Email me the receipt (R-82, D-68): an optional address for this invoice's receipt only, sent once it is paid. The
// form says where it goes; the address is not kept in the browser.
export function ReceiptEmail({ invoiceId, paid }: ReceiptEmailProps) {
  const [setPayerEmail, { data, error, isLoading }] = useSetPayerEmailMutation();
  const [text, setText] = useState("");
  const status = (error as { status?: unknown } | undefined)?.status;
  const problem = error ? (ANSWERS[status as keyof typeof ANSWERS] ?? COPY.failed) : undefined;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void setPayerEmail({ invoiceId, email: text }).catch(() => {});
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <TextField
        label={COPY.label}
        hint={problem ? undefined : COPY.hint}
        error={problem}
        type="email"
        autoComplete="email"
        maxLength={254}
        value={text}
        onChange={(e) => setText(e.target.value)}
        action={
          <Button type="submit" variant="secondary" loading={isLoading} disabled={!text.trim()}>
            {COPY.send}
          </Button>
        }
      />
      <p role="status" className="text-sm text-muted empty:sr-only">
        {data && !error ? (paid ? COPY.after(data.email) : COPY.before(data.email)) : ""}
      </p>
    </form>
  );
}
