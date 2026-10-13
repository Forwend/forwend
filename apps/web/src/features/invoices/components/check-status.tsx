"use client";

import { Button } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { useRecheckInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { chainName } from "@/shared/lib/chains";

const TOO_MANY_REQUESTS = 429;
// After a "too soon" answer the button rests at least this long; the read (polled every 15 s) then gives the exact
// time.
const TOO_SOON_REST_MS = 30_000;

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
  // Asked too soon (another tab, or before the read caught up): rest, then the button comes back.
  const tooSoon = (error as { status?: unknown } | undefined)?.status === TOO_MANY_REQUESTS;
  const [restUntil, setRestUntil] = useState(0);
  // Each refused press is a new error object, so each one rests again.
  useEffect(() => {
    if ((error as { status?: unknown } | undefined)?.status === TOO_MANY_REQUESTS)
      setRestUntil(Date.now() + TOO_SOON_REST_MS);
  }, [error]);
  const next = Math.max(
    Date.parse(data?.nextCheckAt ?? nextCheckAt ?? "") || 0,
    tooSoon ? restUntil : 0,
  );
  const left = useLeft(next);
  const resting = left > 0;

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
      <p className="text-sm text-muted">
        <span role="status">
          {[
            tooSoon ? COPY.recheckTooSoon : error ? COPY.recheckFailed : null,
            data ? COPY.recheck(data, network, money) : null,
            data && data.unreadable.length > 0
              ? COPY.recheckUnreadable(data.unreadable.map(chainName).join(", "))
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {/* The countdown sits outside the live region, so screen readers are not told each second. */}
        {left > 0 ? (
          <span>
            {data || tooSoon || error ? " · " : null}
            {COPY.nextCheck(roughly(left))}
          </span>
        ) : null}
      </p>
    </div>
  );
}

// Whole minutes are enough for a wait this long; seconds only in the last minute.
function roughly(ms: number): string {
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`;
}

// Milliseconds until `until`, again each second while there are any.
function useLeft(until: number): number {
  const [, tick] = useState(0);
  const left = until - Date.now();
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, 1000));
    return () => clearTimeout(timer);
  });
  return left;
}
