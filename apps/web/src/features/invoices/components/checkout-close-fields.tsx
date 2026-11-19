"use client";

import { DatePicker, SegmentedControl, TextField } from "@forwend/ui-web";
import { TriangleAlert } from "lucide-react";
import { CUSTOM_EXPIRY, EXPIRY_CHOICES } from "@/features/invoices/constants/invoices";
import { NEW_INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { type CheckoutClose, localDate } from "@/features/invoices/hooks/use-checkout-close";
import { formatDueDate } from "@/features/invoices/lib/invoices";
import type { Expiry } from "@/features/invoices/types/invoices";
import { ENTER } from "@/shared/constants/motion";

const DAY_MS = 86_400_000;
const EXPIRIES = [...Object.keys(EXPIRY_CHOICES), CUSTOM_EXPIRY] as Expiry[];

export interface CheckoutCloseFieldsProps {
  close: CheckoutClose;
  error?: string;
}

/** A preset or a day and time, and whether it leaves a late client's payment held. */
export function CheckoutCloseFields({ close, error }: CheckoutCloseFieldsProps) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* The control's own legend names it for screen readers. */}
        <p aria-hidden className="text-sm font-medium text-ink">
          {COPY.expiryLabel}
        </p>
        <SegmentedControl
          size="sm"
          label={COPY.expiryLabel}
          value={close.expiry}
          onValueChange={close.pickExpiry}
          className="self-start max-sm:self-stretch"
          options={EXPIRIES.map((value) => ({ value, label: COPY.expiry[value] }))}
        />
      </div>
      {close.expiry === CUSTOM_EXPIRY ? (
        <div className={`grid gap-5 sm:grid-cols-2 ${ENTER}`}>
          <DatePicker
            label={COPY.closesOn}
            value={close.closesOn}
            onChange={close.pickClosesOn}
            min={close.today}
            max={localDate(Date.now() + 365 * DAY_MS)}
            error={error}
          />
          <TextField
            type="time"
            label={COPY.closesAt}
            name="closesAt"
            defaultValue="17:00"
            onChange={close.pickTime}
          />
        </div>
      ) : null}
      {/* Always mounted, so a screen reader hears the line when it appears or changes. */}
      <div role="status" className="empty:hidden">
        {close.early ? (
          <p
            className={`flex items-start gap-2.5 rounded-md bg-warning-soft px-3.5 py-2.5 text-sm text-warning ${ENTER}`}
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0" />
            {/* Set by the due date and still short: only the 365-day limit can have cut it. */}
            {close.followsDue
              ? COPY.closesAtLimit(formatDueDate(close.early))
              : COPY.closesEarly(formatDueDate(close.early))}
          </p>
        ) : close.followsDue && close.closesOn ? (
          <p className={`text-sm text-muted ${ENTER}`}>
            {COPY.followsDue(formatDueDate(close.closesOn))}
          </p>
        ) : null}
      </div>
    </>
  );
}
