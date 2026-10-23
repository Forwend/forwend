"use client";

import { BUTTON_VARIANTS, Button } from "@forwend/ui-web";
import { useEffect, useRef } from "react";
import { useStopRemindersMutation } from "@/features/invoices/api/invoices-api";
import { STOP_REMINDERS_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { invoiceNumber } from "@/features/invoices/lib/invoices";

const NOT_FOUND = 404;

// R-96: asks first, since mail scanners open links; focus then moves to the heading that says so.
export function StopReminders({ token }: { token: string }) {
  const [stop, { data, error, isLoading }] = useStopRemindersMutation();
  const status = (error as { status?: unknown } | undefined)?.status;
  const heading = useRef<HTMLHeadingElement>(null);
  const stopped = !!data;
  useEffect(() => {
    if (stopped) heading.current?.focus();
  }, [stopped]);
  return (
    <div className="fw-panel flex w-full max-w-md flex-col gap-4 p-6 sm:p-8">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-ink outline-none"
      >
        {data ? COPY.doneTitle : COPY.title}
      </h1>
      {data ? (
        <p role="status" className="text-ink">
          {COPY.doneFor} <span className="whitespace-nowrap">{invoiceNumber(data.number)}</span>
          {COPY.doneFrom(data.from)}
        </p>
      ) : (
        <>
          <p className="text-muted">{COPY.body}</p>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {status === NOT_FOUND ? COPY.notFound : COPY.failed}
            </p>
          ) : null}
          <Button
            variant={BUTTON_VARIANTS.primary}
            loading={isLoading}
            onClick={() => void stop(token)}
            className="self-start"
          >
            {COPY.action}
          </Button>
        </>
      )}
    </div>
  );
}
