"use client";
import { Button, DateRangePicker, Dialog } from "@forwend/ui-web";
import { useRef, useState } from "react";
import { useLazyExportPaymentsQuery } from "@/features/payments/api/payments-api";
import { RECONCILIATION_COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentFilters } from "@/features/payments/types/payments";
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
      setError("Choose a To day on or after From.");
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
      setError(
        (failure as { data?: { error?: { code?: string } } }).data?.error?.code ===
          "too_many_movements"
          ? "This period has more than 10,000 records. Choose a shorter period."
          : "We could not export payment records. Try again.",
      );
    }
  };
  return (
    <Dialog
      title="Export payment records"
      triggerLabel="Export payments"
      trigger={(open) => (
        <Button
          disabled={disabled}
          variant="secondary"
          onClick={() => {
            setError("");
            open();
          }}
        >
          Export
        </Button>
      )}
    >
      <p className="text-sm text-muted">
        One row per booked movement, plus separate unbooked observations. Includes the current
        store, source and status filters.
      </p>
      <p className="mt-2 text-sm text-muted">
        Dates use when Forwend recorded the movement, in UTC. Observations do not count toward
        booked totals. USD uses $1 per accepted stablecoin.
      </p>
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
          Download CSV
        </Button>
      </form>
    </Dialog>
  );
}
