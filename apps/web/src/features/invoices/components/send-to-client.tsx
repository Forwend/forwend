"use client";

import { BUTTON_VARIANTS, Button, TONES, useToast } from "@forwend/ui-web";
import { Send } from "lucide-react";
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
  payable: boolean;
}

// R-94.
export function SendToClient({
  profileId,
  invoiceId,
  number,
  email,
  sends,
  payable,
}: SendToClientProps) {
  const [send, { isLoading }] = useSendInvoiceMutation();
  const toast = useToast();
  const last = sends.at(-1);
  const next = last ? Date.parse(last.requestedAt) + SEND_EVERY_MS : 0;
  const waiting = payable && next > Date.now();
  // The button goes once sent: focus moves to the line that takes its place, when the refetch shows it.
  const again = useRef<HTMLParagraphElement>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (sent && waiting) {
      again.current?.focus();
      setSent(false);
    }
  }, [sent, waiting]);
  if (!email && sends.length === 0) {
    return payable ? (
      <p className="px-4 pb-4 text-sm text-muted sm:px-5">{COPY.send.noEmail}</p>
    ) : null;
  }

  const onSend = async (email: string) => {
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

  if (sends.length === 0 && !payable) return null;
  // Past sends name no address: the client email can change after them (R-127).
  return (
    <div className="flex flex-col items-start gap-3 border-t border-line px-4 py-4 sm:px-5">
      {sends.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {sends.map((s) => (
            <li key={s.requestedAt} className="break-words">
              {s.sentAt
                ? COPY.send.sent(TIME.format(new Date(s.sentAt)))
                : s.failedAt
                  ? COPY.send.failed(TIME.format(new Date(s.requestedAt)))
                  : COPY.send.sending(email)}
            </li>
          ))}
        </ul>
      ) : null}
      {!email ? (
        payable ? (
          <p className="text-sm text-muted">{COPY.send.noEmail}</p>
        ) : null
      ) : waiting ? (
        <p ref={again} tabIndex={-1} className="text-sm text-muted outline-none">
          {COPY.send.again(TIME.format(new Date(next)))}
        </p>
      ) : payable ? (
        <Button
          size="sm"
          variant={BUTTON_VARIANTS.secondary}
          loading={isLoading}
          onClick={() => onSend(email)}
        >
          <Send aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.send.action}
        </Button>
      ) : null}
    </div>
  );
}
