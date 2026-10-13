"use client";

import { PaymentTimeline, STEP_STATES, TONES } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { API_PAYMENT_STATUSES } from "@/features/activity/activity";
import {
  confirmingProgress,
  INVOICE_STEPS,
  INVOICE_TIMELINE,
  type Invoice,
  type InvoiceStep,
  invoiceProgress,
} from "@/features/invoices/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/invoices-copy";

/**
 * The status timeline. While a payment confirms, its bar fills as blocks pass of those it had to wait (R-73); until one
 * passes it shows a sweep. `waiting` false shows no step in progress (a closed checkout). `steps` picks which steps
 * show: the payer's end at Paid (R-68).
 */
export function InvoiceTimeline({
  invoice,
  label,
  waiting = true,
  steps: shownSteps = INVOICE_TIMELINE,
}: {
  invoice: Invoice;
  label: string;
  waiting?: boolean;
  steps?: readonly InvoiceStep[];
}) {
  const { done: reached, current, blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  // A fast chain can go from nothing to paid in one read: the steps still show one after another (R-62).
  const done = useStepped(reached);
  const confirming = current === INVOICE_STEPS.confirming && done === reached;

  // Partly paid shows on the Paid step itself, as a tinted label, filled by the share received (R-69); not while
  // the next payment still confirms: that step is the one in progress.
  const partly =
    current !== INVOICE_STEPS.confirming &&
    (invoice.paymentStatus === API_PAYMENT_STATUSES.partiallyPaid ||
      invoice.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid);
  const received = invoice.deposits
    .filter((d) => !d.late)
    .reduce((sum, d) => sum + BigInt(d.amount), 0n);
  const share = Number((received * 1000n) / BigInt(invoice.amount)) / 1000;
  const steps = shownSteps.map((step) => {
    const i = INVOICE_TIMELINE.indexOf(step);
    const partlyPaid = partly && step === INVOICE_STEPS.paid;
    const counting = confirming && step === INVOICE_STEPS.confirming && i === done;
    // The step carries its own count and time, so no line under the steps repeats it.
    const label = partlyPaid
      ? COPY.partlyPaid
      : counting
        ? COPY.confirmingStep(
            Math.max(0, blocksTotal - blocksLeft),
            Math.max(blocksTotal, blocksLeft),
          )
        : step === INVOICE_STEPS.confirming && i < done
          ? COPY.confirmed
          : COPY.steps[step];
    return {
      label,
      hint: counting ? COPY.confirmingHint(secondsLeft) : undefined,
      tone: partlyPaid ? TONES.warning : undefined,
      state:
        i < done
          ? STEP_STATES.complete
          : i === done && (done < reached || (step === current && waiting))
            ? STEP_STATES.current
            : STEP_STATES.upcoming,
      // The waiting step moves, so it never reads as stuck: confirming fills by blocks, partly paid by the share,
      // anything else sweeps (paid out while settling included). A step passed through on the way shows full.
      ...(i === done && done === reached && step === current
        ? {
            progress: confirming
              ? confirmingProgress(blocksLeft, blocksTotal)
              : partlyPaid
                ? share
                : null,
          }
        : {}),
    };
  });
  return <PaymentTimeline label={label} steps={steps} />;
}

const STEP_MS = 600;

/** Follows `reached` one step per STEP_MS going forward, and at once going back (a reorg). */
function useStepped(reached: number): number {
  const [shown, setShown] = useState(reached);
  useEffect(() => {
    if (shown >= reached) return;
    const timer = setTimeout(() => setShown((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [shown, reached]);
  if (shown > reached) setShown(reached);
  return Math.min(shown, reached);
}

/**
 * "Confirming (4/12) · about 19 min left" for screen readers, in a live line: the Confirming step shows the same, so
 * it stays hidden on screen.
 */
export function ConfirmingStatus({
  blocks,
  total,
  seconds,
}: {
  blocks: number;
  total: number;
  seconds: number;
}) {
  return (
    <span className="sr-only">
      {COPY.confirming(Math.max(0, total - blocks), Math.max(total, blocks), seconds)}
    </span>
  );
}
