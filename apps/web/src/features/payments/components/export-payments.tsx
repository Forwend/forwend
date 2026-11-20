"use client";
import { Button, DateRangePicker, Dialog } from "@forwend/ui-web";
import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { useLazyExportPaymentsQuery } from "@/features/payments/api/payments-api";
import { PAYMENTS_COPY, RECONCILIATION_COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentFilters } from "@/features/payments/types/payments";
import { apiError } from "@/shared/api/api-error";

const COPY = PAYMENTS_COPY.export;

export interface ExportPaymentsProps {
  disabled?: boolean;
  profileId: string;
  filters?: PaymentFilters;
  paymentId?: string;
}
export function ExportPayments({
  profileId,
  filters,
  paymentId,
  disabled = false,
}: ExportPaymentsProps) {
  const [download, state] = useLazyExportPaymentsQuery();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const save = async () => {
    if (disabled) return;
    if (from && to && from > to) {
      setError(COPY.badRange);
      return;
    }
    setError("");
    try {
      const csv = await download({
        profileId,
        filters,
        paymentId,
        from: from || undefined,
        to: to || undefined,
      }).unwrap();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      Object.assign(document.createElement("a"), {
        href: url,
        download: "forwend-payment-movements.csv",
      }).click();
      URL.revokeObjectURL(url);
      form.current?.closest("dialog")?.close();
    } catch (failure) {
      setError(apiError(failure).code === "too_many_movements" ? COPY.tooMany : COPY.failed);
    }
  };
  return (
    <Dialog
      title={COPY.title}
      triggerLabel={COPY.trigger}
      trigger={(open) => (
        <Button
          disabled={disabled}
          variant="secondary"
          aria-label={COPY.short}
          onClick={() => {
            setError("");
            open();
          }}
          className="max-sm:w-10 max-sm:px-0 max-sm:pointer-coarse:before:left-1/2 max-sm:pointer-coarse:before:w-11 max-sm:pointer-coarse:before:-translate-x-1/2"
        >
          <Download aria-hidden className="size-[var(--fw-icon-sm)]" />
          <span className="max-sm:sr-only">{COPY.short}</span>
        </Button>
      )}
    >
      <p className="text-sm text-muted">{COPY.rows}</p>
      <p className="mt-2 text-sm text-muted">{COPY.dates}</p>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="mt-4 flex flex-col gap-4"
      >
        <DateRangePicker
          label={RECONCILIATION_COPY.period}
          value={{ from: from || null, to: to || null }}
          note={RECONCILIATION_COPY.periodNote}
          clearLabel={RECONCILIATION_COPY.clearPeriod}
          onChange={(range) => {
            setFrom(range.from ?? "");
            setTo(range.to ?? "");
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={state.isFetching || disabled}>
          {COPY.download}
        </Button>
      </form>
    </Dialog>
  );
}
