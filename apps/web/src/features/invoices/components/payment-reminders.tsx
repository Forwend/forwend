"use client";

import { Switch, TONES, useToast } from "@forwend/ui-web";
import { useSetRemindersMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import type { InvoiceReminders, ReminderStep } from "@/features/invoices/types/invoices";
import { errorStatus, HTTP_STATUS } from "@/shared/api/api-error";
import { dateTime } from "@/shared/lib/dates";

const COPY = INVOICE_COPY.reminders;

export interface PaymentRemindersProps {
  profileId: string;
  invoiceId: string;
  reminders: InvoiceReminders;
  hasDueDate: boolean;
  payable: boolean;
}

// The client's stop is final, so the switch stays off and says when.
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
      const status = errorStatus(failure);
      toast({
        tone: TONES.warning,
        title: status === HTTP_STATUS.conflict ? COPY.conflict : COPY.error,
      });
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
          ? COPY.stopped(dateTime(reminders.stoppedAt))
          : hasDueDate
            ? COPY.hint
            : COPY.needsDue}
      </p>
      {reminders.emails.length > 0 ? (
        <ul className="flex flex-col gap-1 pb-1 text-sm text-muted">
          {reminders.emails.map((r) => (
            <li key={r.requestedAt} className="break-words">
              {COPY.steps[r.step as ReminderStep] ?? r.step} ·{" "}
              {r.sentAt ? COPY.sent(dateTime(r.sentAt)) : r.failedAt ? COPY.failed : COPY.sending}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
