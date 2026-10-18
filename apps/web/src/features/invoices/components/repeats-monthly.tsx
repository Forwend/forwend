"use client";

import { BUTTON_VARIANTS, Button, Dialog, TONES, useToast } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { useStopRepeatMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { formatDueDate } from "@/features/invoices/lib/invoices";
import type { InvoiceRetainer } from "@/features/invoices/types/invoices";

const COPY = INVOICE_COPY.repeat;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export interface RepeatsMonthlyProps {
  profileId: string;
  invoiceId: string;
  retainer: InvoiceRetainer;
}

// A retainer (R-99) under Payment reminders: when the next invoice is due and emailed, or when it ended or stopped.
// Stop repeating asks first, since it can't be undone. The button goes once stopped, so focus moves to the line that
// says so, when the refetch shows it.
export function RepeatsMonthly({ profileId, invoiceId, retainer }: RepeatsMonthlyProps) {
  const [stop, { isLoading, isError }] = useStopRepeatMutation();
  const toast = useToast();
  const line = useRef<HTMLParagraphElement>(null);
  const [stopped, setStopped] = useState(false);
  const { endDate, nextDueDate, nextOn, stoppedAt } = retainer;
  useEffect(() => {
    if (stopped && stoppedAt) {
      line.current?.focus();
      setStopped(false);
    }
  }, [stopped, stoppedAt]);
  const confirm = async () => {
    try {
      await stop({ profileId, invoiceId }).unwrap();
      toast({ tone: TONES.success, title: COPY.done });
      setStopped(true);
    } catch {
      // The dialog says so and stays open.
    }
  };

  return (
    <div className="flex flex-col items-start gap-1 border-t border-line px-4 py-3 sm:px-5">
      <p className="font-medium text-ink">{COPY.title}</p>
      <p ref={line} tabIndex={-1} className="pb-1 text-sm text-muted outline-none">
        {stoppedAt
          ? COPY.stopped(TIME.format(new Date(stoppedAt)))
          : nextDueDate && nextOn
            ? `${COPY.next(formatDueDate(nextDueDate), formatDueDate(nextOn))}${
                endDate ? COPY.last(formatDueDate(endDate)) : ""
              }`
            : endDate
              ? COPY.ended(formatDueDate(endDate))
              : null}
      </p>
      {nextDueDate ? (
        <Dialog
          triggerLabel={COPY.stop}
          title={COPY.stopTitle}
          trigger={(open) => (
            <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={open} className="mb-1">
              {COPY.stop}
            </Button>
          )}
        >
          <p>{COPY.stopBody}</p>
          {isError ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {COPY.error}
            </p>
          ) : null}
          <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
              {COPY.keep}
            </Button>
            <Button
              type="button"
              variant={BUTTON_VARIANTS.danger}
              loading={isLoading}
              onClick={confirm}
            >
              {COPY.stop}
            </Button>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
