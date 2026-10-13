"use client";

import { PaymentTimeline, STEP_STATES } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import {
  confirmingProgress,
  INVOICE_STEPS,
  INVOICE_TIMELINE,
  type Invoice,
  invoiceProgress,
} from "@/features/invoices/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/invoices-copy";

/**
 * The status timeline. While a payment confirms, its bar fills as blocks pass, measured from the most blocks left seen
 * on this page; until one passes it shows a sweep. `waiting` false shows no step in progress (a closed checkout).
 */
export function InvoiceTimeline({
  invoice,
  label,
  waiting = true,
}: {
  invoice: Invoice;
  label: string;
  waiting?: boolean;
}) {
  const { done: reached, current, blocksLeft } = invoiceProgress(invoice);
  // A fast chain can go from nothing to paid in one read: the steps still show one after another (R-62).
  const done = useStepped(reached);
  const confirming = current === INVOICE_STEPS.confirming && done === reached;
  // Remembered across reads; a new payment starts counting again.
  const [most, setMost] = useState(0);
  const next = confirming ? Math.max(most, blocksLeft) : 0;
  if (next !== most) setMost(next);

  const steps = INVOICE_TIMELINE.map((step, i) => ({
    label: COPY.steps[step],
    state:
      i < done
        ? STEP_STATES.complete
        : i === done && (done < reached || (step === current && waiting))
          ? STEP_STATES.current
          : STEP_STATES.upcoming,
    // A current step that is not confirming has not started filling: a full bar would read as done. A step passed
    // through on the way shows full.
    ...(i === done && done === reached && step === current
      ? { progress: confirming ? confirmingProgress(blocksLeft, next) : 0 }
      : {}),
  }));
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
 * "Confirming (4/12) · about 19 min left": blocks passed of the most left seen on this page, as the timeline's bar
 * counts them (the API gives no starting count).
 */
export function ConfirmingStatus({ blocks, seconds }: { blocks: number; seconds: number }) {
  const [most, setMost] = useState(blocks);
  if (blocks > most) setMost(blocks);
  const total = Math.max(most, blocks);
  return <>{COPY.confirming(total - blocks, total, seconds)}</>;
}
