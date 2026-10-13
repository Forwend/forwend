"use client";

import { Button } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { useRecheckInvoiceMutation } from "@/features/invoices/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/invoices-copy";

const TOO_MANY_REQUESTS = 429;

/**
 * Check status (R-55): asks Forwend to read the invoice's address on chain again and says what it found. The button
 * rests until the next check the api allows, so presses never pile up.
 */
export function CheckStatus({
  invoiceId,
  network,
  money,
}: {
  invoiceId: string;
  network: string;
  money: (units: bigint) => string;
}) {
  const [recheck, { data, isLoading, error }] = useRecheckInvoiceMutation();
  const tooSoon = (error as { status?: unknown } | undefined)?.status === TOO_MANY_REQUESTS;
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (!data) return;
    const wait = Date.parse(data.nextCheckAt) - Date.now();
    if (wait <= 0) return;
    setResting(true);
    const timer = setTimeout(() => setResting(false), wait);
    return () => clearTimeout(timer);
  }, [data]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        size="sm"
        variant="secondary"
        loading={isLoading}
        disabled={resting}
        onClick={() => void recheck(invoiceId)}
      >
        {COPY.checkStatus}
      </Button>
      <p role="status" className="text-sm text-muted empty:hidden">
        {tooSoon
          ? COPY.recheckTooSoon
          : error
            ? COPY.recheckFailed
            : data
              ? COPY.recheck(data, network, money)
              : ""}
      </p>
    </div>
  );
}
