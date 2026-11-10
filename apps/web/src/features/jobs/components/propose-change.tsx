"use client";

import { BUTTON_VARIANTS, Button, Dialog, TextField, TONES, useToast } from "@forwend/ui-web";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useProposeChangeMutation } from "@/features/jobs/api/jobs-api";
import { CHANGE_ERRORS, JOB_LIMITS } from "@/features/jobs/constants/jobs";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { dueDays, paymentCents } from "@/features/jobs/lib/jobs";
import type { PaymentField } from "@/features/jobs/types/jobs";
import { usdFromCents } from "@/shared/lib/money";

const COPY = JOBS_COPY.detail;
const FORM = JOBS_COPY.form;
const INVALID_VALUE = 422;

export interface ProposeChangeProps {
  profileId: string;
  jobId: string;
  /** Called once added: the button goes while the change waits, so the page moves focus to it. */
  onProposed: () => void;
}

// R-106. One key per filled-in form, so a double click or a retry adds one change.
export function ProposeChange({ profileId, jobId, onProposed }: ProposeChangeProps) {
  const [propose, { isLoading }] = useProposeChangeMutation();
  const toast = useToast();
  const keys = useRef(new Map<string, string>());
  const actions = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("14");
  const [errors, setErrors] = useState<Partial<Record<PaymentField, string>>>({});
  const [error, setError] = useState("");

  const confirm = async () => {
    const cents = paymentCents(amount);
    const due = dueDays(days);
    const shown = {
      title: title.trim() ? undefined : FORM.errors.required,
      amount: cents === null ? FORM.errors.amount : undefined,
      dueDays: due === null ? FORM.errors.dueDays : undefined,
    };
    flushSync(() => {
      setErrors(shown);
      setError("");
    });
    document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"]')?.focus();
    if (cents === null || due === null || !title.trim()) return;
    const body = { title: title.trim(), amountUsd: usdFromCents(cents), dueDays: due };
    const values = JSON.stringify(body);
    const key = keys.current.get(values) ?? crypto.randomUUID();
    keys.current.set(values, key);
    try {
      const made = await propose({ profileId, jobId, idempotencyKey: key, body }).unwrap();
      const email = made.payments.at(-1)?.clientEmailed ? made.acceptedEmail : null;
      toast({
        tone: TONES.success,
        title: email ? COPY.proposedEmailed(body.title, email) : COPY.proposed(body.title),
      });
      onProposed();
    } catch (failure) {
      const { status, data } = failure as {
        status?: unknown;
        data?: { error?: { code?: string } };
      };
      const code = data?.error?.code;
      // The job is read again after a 409, which takes this dialog away: the reason goes in a toast, which stays.
      if (code === CHANGE_ERRORS.pending || code === CHANGE_ERRORS.finished) {
        actions.current?.closest("dialog")?.close();
        document.getElementById("job-payments")?.focus();
        toast({
          tone: TONES.warning,
          title: code === CHANGE_ERRORS.pending ? COPY.proposePending : COPY.proposeFinished,
        });
        return;
      }
      setError(status === INVALID_VALUE ? COPY.proposeInvalid : COPY.proposeFailed);
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.propose}
      title={COPY.propose}
      trigger={(open) => (
        <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={open}>
          <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.propose}
        </Button>
      )}
    >
      <p>{COPY.proposeBody}</p>
      <div className="mt-4 flex flex-col gap-4">
        <TextField
          label={COPY.proposeTitleLabel}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={JOB_LIMITS.paymentTitle}
          autoComplete="off"
          error={errors.title}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={FORM.amount}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            error={errors.amount}
          />
          <TextField
            label={FORM.dueDays}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            error={errors.dueDays}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <form ref={actions} method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.proposeKeep}
        </Button>
        <Button type="button" loading={isLoading} onClick={confirm}>
          {COPY.proposeConfirm}
        </Button>
      </form>
    </Dialog>
  );
}
