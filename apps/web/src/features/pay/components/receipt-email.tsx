"use client";

import { Button, TextField } from "@forwend/ui-web";
import { Check, Mail } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSetPayerEmailMutation } from "@/features/invoices/api/invoices-api";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";

const COPY = PAY_COPY.receipt;
const ANSWERS = { 409: COPY.sent, 422: COPY.invalid, 429: COPY.tooMany } as const;
const ENTER =
  "transition-[opacity,transform] duration-[var(--fw-duration-base)] ease-[var(--fw-ease-out)] starting:translate-y-1 starting:opacity-0";

export interface ReceiptEmailProps {
  /** The pay link's token (D-86). */
  linkToken: string;
  paid: boolean;
}

// R-82, D-68: the address is for this invoice's receipt only and is never kept in the browser.
export function ReceiptEmail({ linkToken, paid }: ReceiptEmailProps) {
  const [setPayerEmail, { data, error, isLoading, reset }] = useSetPayerEmailMutation();
  const [step, setStep] = useState<"folded" | "form" | "done">("folded");
  const [text, setText] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const status = (error as { status?: unknown } | undefined)?.status;
  const problem = error ? (ANSWERS[status as keyof typeof ANSWERS] ?? COPY.failed) : undefined;
  useEffect(() => {
    if (step === "form") form.current?.querySelector("input")?.focus();
    // The Send button is gone: keyboard and screen reader users land on what replaced it.
    if (step === "done") done.current?.focus();
  }, [step]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPayerEmail({ payToken: linkToken, email: text })
      .unwrap()
      .then(() => setStep("done"))
      .catch(() => {});
  };

  return (
    <div className="border-t border-line px-4 py-3 sm:px-5">
      {step === "done" && data ? (
        <div
          ref={done}
          tabIndex={-1}
          className={`flex items-start gap-3 py-1 outline-none ${ENTER}`}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-success-soft text-success transition-[opacity,transform] delay-[60ms] duration-[var(--fw-duration-base)] ease-[var(--fw-ease-out)] starting:scale-90 starting:opacity-0">
            <Check aria-hidden className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p role="status" className="text-sm font-medium text-ink">
              {paid ? COPY.sentTitle : COPY.savedTitle}
            </p>
            <p className="text-sm break-words text-muted">
              {paid ? COPY.after(data.email) : COPY.before(data.email)}
            </p>
            {/* Once paid the receipt goes out at once; another address could only be refused (409). */}
            {paid ? null : (
              <Button
                variant="link"
                onClick={() => {
                  reset();
                  setStep("form");
                }}
                className="mt-1 self-start"
              >
                {COPY.another}
              </Button>
            )}
          </div>
        </div>
      ) : step === "form" ? (
        <form
          ref={form}
          onSubmit={submit}
          className={`flex flex-col gap-2 py-1 ${ENTER}`}
          noValidate
        >
          <TextField
            label={COPY.label}
            hint={problem ? undefined : COPY.hint}
            error={problem}
            type="email"
            autoComplete="email"
            placeholder={COPY.placeholder}
            maxLength={254}
            value={text}
            readOnly={isLoading}
            onChange={(e) => setText(e.target.value)}
            action={
              <Button type="submit" variant="secondary" loading={isLoading} disabled={!text.trim()}>
                {COPY.send}
              </Button>
            }
          />
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setStep("form")} className="-mx-4">
          <Mail aria-hidden className="size-[var(--fw-icon-sm)] text-muted" />
          {COPY.open}
        </Button>
      )}
    </div>
  );
}
