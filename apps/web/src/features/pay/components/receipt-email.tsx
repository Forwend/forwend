"use client";

import { Button, TextField } from "@forwend/ui-web";
import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSetPayerEmailMutation } from "@/features/invoices/api/invoices-api";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";

const COPY = PAY_COPY.receipt;
const ANSWERS = { 409: COPY.sent, 422: COPY.invalid, 429: COPY.tooMany } as const;

export interface ReceiptEmailProps {
  invoiceId: string;
  paid: boolean;
}

// Email me the receipt (R-82, D-68): the pay panel's last row, folded until the payer asks for it, so the steps to pay
// stay first. An optional address for this invoice's receipt only, sent once it is paid; not kept in the browser.
export function ReceiptEmail({ invoiceId, paid }: ReceiptEmailProps) {
  const [setPayerEmail, { data, error, isLoading }] = useSetPayerEmailMutation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const status = (error as { status?: unknown } | undefined)?.status;
  const problem = error ? (ANSWERS[status as keyof typeof ANSWERS] ?? COPY.failed) : undefined;
  useEffect(() => {
    if (open) form.current?.querySelector("input")?.focus();
  }, [open]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void setPayerEmail({ invoiceId, email: text }).catch(() => {});
  };
  return (
    <div className="border-t border-line px-4 py-3 sm:px-5">
      {open ? (
        <form ref={form} onSubmit={submit} className="flex flex-col gap-2 py-1" noValidate>
          <TextField
            label={COPY.label}
            hint={problem ? undefined : COPY.hint}
            error={problem}
            type="email"
            autoComplete="email"
            placeholder={COPY.placeholder}
            maxLength={254}
            value={text}
            onChange={(e) => setText(e.target.value)}
            action={
              <Button type="submit" variant="secondary" loading={isLoading} disabled={!text.trim()}>
                {COPY.send}
              </Button>
            }
          />
          <p role="status" className="text-sm text-success empty:sr-only">
            {data && !error ? (paid ? COPY.after(data.email) : COPY.before(data.email)) : ""}
          </p>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-mx-2 inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Mail aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.open}
        </button>
      )}
    </div>
  );
}
