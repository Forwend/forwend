"use client";

import {
  Badge,
  BigAmount,
  Button,
  COPY_STATUS,
  PAYMENT_STATUS,
  QrCode,
  StatusPill,
  TONES,
  useCopy,
} from "@forwend/ui-web";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { CheckoutActions } from "@/features/checkout/components/checkout-actions";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { paymentDisplayStatus, paymentLabel } from "@/features/payments/lib/payments";
import { MONEY_COPY } from "@/shared/constants/money-copy";

// The customer is standing there: check often, and stop once the sale is decided.
const POLL_MS = 3_000;
const DONE = new Set<string>([
  PAYMENT_STATUS.paid,
  PAYMENT_STATUS.overpaid,
  PAYMENT_STATUS.expired,
  PAYMENT_STATUS.expiredPartiallyPaid,
  PAYMENT_STATUS.canceled,
]);

export interface CheckoutLiveProps {
  profileId: string;
  session: CheckoutSession;
  amountUsd: string;
  onNewSale: () => void;
}

/** The screen the customer sees: the amount and one QR code; the status underneath is for the merchant. */
export function CheckoutLive({ profileId, session, amountUsd, onNewSale }: CheckoutLiveProps) {
  const [done, setDone] = useState(false);
  // The form that started the sale is gone, so focus moves to what replaced it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const read = useGetPaymentQuery(
    { profileId, paymentId: session.payment.paymentId },
    { pollingInterval: done ? 0 : POLL_MS, skipPollingIfUnfocused: false },
  );
  const payment = read.currentData ?? session.payment;
  const status = paymentDisplayStatus(payment);
  if (DONE.has(status) !== done) setDone(DONE.has(status));
  const url = payment.hostedUrl ?? "";
  const [copied, copy] = useCopy(url);
  const paid = status === PAYMENT_STATUS.paid || status === PAYMENT_STATUS.overpaid;
  const open = !done;
  const sentence =
    status === PAYMENT_STATUS.confirming || status === PAYMENT_STATUS.detected
      ? COPY.status.confirming
      : status === PAYMENT_STATUS.partiallyPaid
        ? COPY.status.partial
        : paid
          ? COPY.status.paid
          : done
            ? COPY.status.closed
            : COPY.status.waiting;

  return (
    <section aria-labelledby="checkout-scan" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-10 items-center gap-2">
        <h2
          id="checkout-scan"
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-base font-semibold text-ink outline-none"
        >
          {paymentLabel(payment)}
        </h2>
        {payment.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
        <CheckoutActions
          profileId={profileId}
          paymentId={payment.paymentId}
          cancelable={status === PAYMENT_STATUS.open}
          withPayment
          onDone={() => heading.current?.focus()}
        />
      </div>
      <div className="fw-panel">
        <div className="flex flex-col items-center gap-4 px-4 py-6 text-center sm:px-5">
          <p className="text-ink">
            <BigAmount value={formatUsd(usdToCents(amountUsd))} className="text-5xl" />{" "}
            <span className="text-base text-subtle">{MONEY_COPY.usd}</span>
          </p>
          {open && url ? (
            <>
              <QrCode
                value={url}
                label={COPY.scan}
                className="w-full max-w-64 border border-line p-2"
              />
              <p className="max-w-xs text-sm text-muted">{COPY.scanHint}</p>
            </>
          ) : paid ? (
            <span className="grid size-24 place-items-center rounded-pill bg-success-soft text-success">
              <Check aria-hidden className="size-10" />
            </span>
          ) : null}
          <div className="flex flex-col items-center gap-1">
            <StatusPill status={status} />
            <p role="status" className="text-ink">
              {sentence}
            </p>
            {open ? (
              <p className="text-sm text-muted">
                {COPY.closes(
                  new Date(payment.closesAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                )}
              </p>
            ) : null}
          </div>
        </div>
        {done || (open && url) ? (
          <div className="border-t border-line p-4 sm:p-5">
            {done ? (
              <Button className="w-full" onClick={onNewSale}>
                {COPY.newSale}
              </Button>
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => void copy()}>
                {copied === COPY_STATUS.copied ? (
                  <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
                ) : (
                  <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
                )}
                {copied === COPY_STATUS.copied ? COPY.copied : COPY.copyLink}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** "12.5" → 1250n: the form checked the amount, so it has at most two decimals. */
function usdToCents(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
