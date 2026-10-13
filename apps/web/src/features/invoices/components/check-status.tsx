"use client";

import { Button } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { useRecheckInvoiceMutation } from "@/features/invoices/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/invoices-copy";
import { chainName } from "@/shared/chains/chains";

/**
 * Check status (R-55): asks Forwend to read the invoice's address on chain again and says what it found. It rests
 * until the next check the api allows, which the invoice read also gives, so a reload never asks again early.
 */
export function CheckStatus({
  invoiceId,
  network,
  money,
  nextCheckAt,
}: {
  invoiceId: string;
  network: string;
  money: (units: bigint) => string;
  nextCheckAt: string | null;
}) {
  const [recheck, { data, isLoading, error }] = useRecheckInvoiceMutation();
  const next = Date.parse(data?.nextCheckAt ?? nextCheckAt ?? "") || 0;
  const now = useNow(next);
  const left = next - now;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        size="sm"
        variant="secondary"
        loading={isLoading}
        disabled={left > 0}
        onClick={() => void recheck(invoiceId)}
      >
        {COPY.checkStatus}
      </Button>
      <p role="status" className="text-sm text-muted empty:hidden">
        {[
          error && !data ? COPY.recheckFailed : null,
          data ? COPY.recheck(data, network, money) : null,
          data && data.unreadable.length > 0
            ? COPY.recheckUnreadable(data.unreadable.map(chainName).join(", "))
            : null,
          left > 0 ? COPY.nextCheck(roughly(left)) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

// Whole minutes are enough for a wait this long; seconds only in the last minute.
function roughly(ms: number): string {
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`;
}

// The time now, once a second while a wait runs out.
function useNow(until: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}
