"use client";

import { BUTTON_VARIANTS, Button, Dialog, TextField, TONES, useToast } from "@forwend/ui-web";
import { useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { useSendInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useMarkPaymentDoneMutation } from "@/features/jobs/api/jobs-api";
import { CHANGE_ERRORS, JOB_LIMITS } from "@/features/jobs/constants/jobs";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, namedField } from "@/features/jobs/lib/jobs";
import type { Job, JobPayment } from "@/features/jobs/types/jobs";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const COPY = JOBS_COPY.detail;
const CONFLICT = 409;
const INVALID_VALUE = 422;

export interface MarkDoneProps {
  profileId: string;
  job: Job;
  payment: JobPayment;
  /** Called once its invoice is made: the button goes, so the page moves focus to that invoice. */
  onDone: (position: number) => void;
}

// R-103: marking it done makes its invoice; Send to client then emails it within its limits (R-94).
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
      const { status, data } = failure as {
        status?: unknown;
        data?: { error?: { code?: string; message?: string } };
      };
      // A 422 names the link only when the link is wrong; the profile's limits on new invoices are 422 too.
      if (status === INVALID_VALUE && namedField(data?.error?.message ?? "", ["deliveryLink"]))
        setLinkError(COPY.markDoneLinkError);
      else if (data?.error?.code === CHANGE_ERRORS.pending) {
        // The job is read again, which takes this step's button and dialog away: the reason goes in a toast.
        actions.current?.closest("dialog")?.close();
        document.getElementById("job-payments")?.focus();
        toast({ tone: TONES.warning, title: COPY.markDoneChangeWaits });
      } else setError(status === CONFLICT ? COPY.markDoneOrder : COPY.markDoneFailed);
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
          `${formatUsd(apiCents(payment.amountUsd))} ${MONEY_COPY.usd}`,
          JOBS_COPY.detail.dueDays(payment.dueDays),
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
