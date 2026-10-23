"use client";

import { Switch, TONES, useToast } from "@forwend/ui-web";
import { useSetRemindersMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceReminders, ReminderStep } from "@/features/invoices/types/invoices";

const COPY = INVOICE_COPY.reminders;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CONFLICT = 409;

export interface PaymentRemindersProps {
  profileId: string;
  invoiceId: string;
  reminders: InvoiceReminders;
  hasDueDate: boolean;
  payable: boolean;
}

// R-96, D-69. The client's stop is final, so the switch stays off and says when.
export function PaymentReminders({
  profileId,
  invoiceId,
  reminders,
  hasDueDate,
  payable,
}: PaymentRemindersProps) {
  const [save, { isLoading }] = useSetRemindersMutation();
  const toast = useToast();
  if (!payable && reminders.emails.length === 0 && !reminders.stoppedAt) return null;
  const flip = async (on: boolean) => {
    try {
      await save({ profileId, invoiceId, on }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved(on) });
    } catch (failure) {
      const status = (failure as { status?: unknown }).status;
      toast({ tone: TONES.warning, title: status === CONFLICT ? COPY.conflict : COPY.error });
    }
  };

  return (
    <div className="flex flex-col gap-1 border-t border-line px-4 py-3 sm:px-5">
      <Switch
        label={COPY.toggle}
        checked={reminders.on && !reminders.stoppedAt}
        onCheckedChange={flip}
        disabled={
          isLoading || !!reminders.stoppedAt || ((!payable || !hasDueDate) && !reminders.on)
        }
        className="w-full flex-row-reverse justify-between font-medium text-ink"
      />
      <p className="pb-1 text-sm text-muted">
        {reminders.stoppedAt
          ? COPY.stopped(TIME.format(new Date(reminders.stoppedAt)))
          : hasDueDate
            ? COPY.hint
            : COPY.needsDue}
      </p>
      {reminders.emails.length > 0 ? (
        <ul className="flex flex-col gap-1 pb-1 text-sm text-muted">
          {reminders.emails.map((r) => (
            <li key={r.requestedAt} className="break-words">
              {COPY.steps[r.step as ReminderStep] ?? r.step} ·{" "}
              {r.sentAt
                ? COPY.sent(TIME.format(new Date(r.sentAt)))
                : r.failedAt
                  ? COPY.failed
                  : COPY.sending}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
