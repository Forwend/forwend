"use client";

import { useEffect, useState } from "react";
import { useRecheckInvoiceMutation } from "@/features/invoices/api/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { errorStatus, HTTP_STATUS } from "@/shared/api/api-error";
import { chainName } from "@/shared/lib/chains";

// At least this long after "too soon"; the read (polled every 15 s) then gives the exact time.
const TOO_SOON_REST_MS = 30_000;

/** Every Check status of one pay link shares its last answer, so the page's status line can read it too. */
export const recheckKey = (payToken: string) => `recheck:${payToken}`;

export interface CheckStatusInput {
  payToken: string | null; // null while it can't be asked
  network: string;
  money: (units: bigint) => string;
  nextCheckAt: string | null;
}

export interface CheckStatusState {
  check: () => void;
  busy: boolean;
  resting: boolean; // until the next check the API allows
  found: string;
  next: string | null; // kept out of the live region
}

/** Rests until the next check the API allows, which the invoice read also gives. */
export function useCheckStatus({
  payToken,
  network,
  money,
  nextCheckAt,
}: CheckStatusInput): CheckStatusState {
  const [recheck, { data, isLoading, error }] = useRecheckInvoiceMutation({
    fixedCacheKey: recheckKey(payToken ?? ""),
  });
  // Asked too soon (another tab, or before the read caught up): rest, then the button comes back.
  const tooSoon = errorStatus(error) === HTTP_STATUS.tooManyRequests;
  const [restUntil, setRestUntil] = useState(0);
  // Each refused press is a new error object, so each one rests again.
  useEffect(() => {
    if (errorStatus(error) === HTTP_STATUS.tooManyRequests)
      setRestUntil(Date.now() + TOO_SOON_REST_MS);
  }, [error]);
  const left = useLeft(
    Math.max(Date.parse(data?.nextCheckAt ?? nextCheckAt ?? "") || 0, tooSoon ? restUntil : 0),
  );
  const found = [
    tooSoon ? COPY.recheckTooSoon : error ? COPY.recheckFailed : null,
    data ? COPY.recheck(data, network, money) : null,
    data && data.unreadable.length > 0
      ? COPY.recheckUnreadable(data.unreadable.map(chainName).join(", "))
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    check: () => {
      if (payToken) void recheck(payToken);
    },
    busy: isLoading,
    resting: left > 0,
    found,
    next: left > 0 ? COPY.nextCheck(roughly(left)) : null,
  };
}

function roughly(ms: number): string {
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`;
}

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
