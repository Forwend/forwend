"use client";

import { BUTTON_VARIANTS, Button, TONES, useToast } from "@forwend/ui-web";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSendInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceSend } from "@/features/invoices/types/invoices";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CONFLICT = 409;
const TOO_MANY = 429;
// The api takes one send per invoice a day (R-94); the button waits the same.
const SEND_EVERY_MS = 24 * 60 * 60 * 1000;

export interface SendToClientProps {
  profileId: string;
  invoiceId: string;
  number: string;
  email: string | null;
  sends: readonly InvoiceSend[];
}

// R-94, while the checkout can take money. Past sends show in the line under it and in Document history.
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
        {COPY.send.again(TIME.format(new Date(next)))}
      </p>
    );
  }

  const onSend = async () => {
    try {
      await send({ profileId, invoiceId, idempotencyKey: crypto.randomUUID() }).unwrap();
      toast({ tone: TONES.success, title: COPY.send.done(number, email) });
      setSent(true);
    } catch (failure) {
      const status = (failure as { status?: unknown }).status;
      toast({
        tone: TONES.warning,
        title:
          status === CONFLICT
            ? COPY.send.closed
            : status === TOO_MANY
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
