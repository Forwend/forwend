"use client";

import { BUTTON_VARIANTS, Button, TONES, useToast } from "@forwend/ui-web";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSendInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceSend } from "@/features/invoices/types/invoices";
import { errorStatus, HTTP_STATUS } from "@/shared/api/api-error";
import { dateTime } from "@/shared/lib/dates";

// The API takes one send per invoice a day.
const SEND_EVERY_MS = 24 * 60 * 60 * 1000;

export interface SendToClientProps {
  profileId: string;
  invoiceId: string;
  number: string;
  email: string | null;
  sends: readonly InvoiceSend[];
}

export function SendToClient({ profileId, invoiceId, number, email, sends }: SendToClientProps) {
  const [send, { isLoading }] = useSendInvoiceMutation();
  const toast = useToast();
  const last = sends.at(-1);
  const next = last ? Date.parse(last.requestedAt) + SEND_EVERY_MS : 0;
  const waiting = next > Date.now();
  // The button goes once sent: focus moves to the line that takes its place, when the refetch shows it.
  const again = useRef<HTMLParagraphElement>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (sent && waiting) {
      again.current?.focus();
      setSent(false);
    }
  }, [sent, waiting]);
  const note = "text-sm text-muted outline-none";
  if (!email) return <p className={note}>{COPY.send.noEmail}</p>;
  if (waiting) {
    return (
      <p ref={again} tabIndex={-1} className={note}>
        {COPY.send.again(dateTime(new Date(next).toISOString()))}
      </p>
    );
  }

  const onSend = async () => {
    try {
      await send({ profileId, invoiceId, idempotencyKey: crypto.randomUUID() }).unwrap();
      toast({ tone: TONES.success, title: COPY.send.done(number, email) });
      setSent(true);
    } catch (failure) {
      const status = errorStatus(failure);
      toast({
        tone: TONES.warning,
        title:
          status === HTTP_STATUS.conflict
            ? COPY.send.closed
            : status === HTTP_STATUS.tooManyRequests
              ? COPY.send.limited
              : COPY.send.error,
      });
    }
  };
  return (
    <Button variant={BUTTON_VARIANTS.secondary} loading={isLoading} onClick={onSend}>
      <Mail aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.send.action}
    </Button>
  );
}
