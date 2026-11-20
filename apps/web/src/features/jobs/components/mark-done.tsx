"use client";

import { BUTTON_VARIANTS, Button, Dialog, TextField, TONES, useToast } from "@forwend/ui-web";
import { useRef, useState } from "react";
import { useSendInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useMarkPaymentDoneMutation } from "@/features/jobs/api/jobs-api";
import { CHANGE_ERRORS, JOB_LIMITS } from "@/features/jobs/constants/jobs";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import type { Job, JobPayment } from "@/features/jobs/types/jobs";
import {
  apiError,
  errorStatus,
  HTTP_STATUS,
  invalidValue,
  namedField,
} from "@/shared/api/api-error";
import { usdCents, usdText } from "@/shared/lib/money";

const COPY = JOBS_COPY.detail;

export interface MarkDoneProps {
  profileId: string;
  job: Job;
  payment: JobPayment;
  onDone: (position: number) => void;
}

export function MarkDone({ profileId, job, payment, onDone }: MarkDoneProps) {
  const [markDone, { isLoading }] = useMarkPaymentDoneMutation();
  const [send] = useSendInvoiceMutation();
  const toast = useToast();
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");
  const actions = useRef<HTMLFormElement>(null);

  const confirm = async () => {
    setError("");
    setLinkError("");
    let made: Job;
    try {
      made = await markDone({
        profileId,
        jobId: job.jobId,
        position: payment.position,
        deliveryLink: link.trim(),
      }).unwrap();
    } catch (failure) {
      // Invoice limits also answer 422: only a message naming the link is a link error.
      if (invalidValue(failure) && namedField(failure, ["deliveryLink"]))
        setLinkError(COPY.markDoneLinkError);
      else if (apiError(failure).code === CHANGE_ERRORS.pending) {
        actions.current?.closest("dialog")?.close();
        document.getElementById("job-payments")?.focus();
        toast({ tone: TONES.warning, title: COPY.markDoneChangeWaits });
      } else
        setError(
          errorStatus(failure) === HTTP_STATUS.conflict ? COPY.markDoneOrder : COPY.markDoneFailed,
        );
      return;
    }
    const invoice = made.payments[payment.position - 1];
    if (!invoice?.invoiceId || !invoice.number) return;
    onDone(payment.position);
    const number = invoiceNumber(invoice.number);
    try {
      await send({
        profileId,
        invoiceId: invoice.invoiceId,
        idempotencyKey: crypto.randomUUID(),
      }).unwrap();
      toast({ tone: TONES.success, title: COPY.sent(number, job.client.email) });
    } catch {
      toast({ tone: TONES.warning, title: COPY.notSent(number) });
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.markDone}
      title={COPY.markDoneTitle(payment.title)}
      trigger={(open) => (
        <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={open} className="self-start">
          {COPY.markDone}
        </Button>
      )}
    >
      <p>
        {COPY.markDoneBody(
          usdText(usdCents(payment.amountUsd)),
          COPY.dueDays(payment.dueDays),
          job.client.email,
        )}
      </p>
      <TextField
        type="url"
        label={COPY.markDoneLink}
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
          setLinkError("");
        }}
        inputMode="url"
        autoComplete="off"
        maxLength={JOB_LIMITS.deliveryLink}
        hint={COPY.markDoneLinkHint}
        error={linkError}
        className="mt-4"
      />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <form ref={actions} method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.markDoneKeep}
        </Button>
        <Button type="button" loading={isLoading} onClick={confirm}>
          {COPY.markDoneConfirm}
        </Button>
      </form>
    </Dialog>
  );
}
