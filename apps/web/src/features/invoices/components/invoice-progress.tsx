"use client";

import { PaymentTimeline, STEP_STATES, TONES } from "@forwend/ui-web";
import { useEffect, useState } from "react";
import { API_PAYMENT_STATUSES } from "@/features/activity/activity";
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

  // Partly paid shows on the Paid step itself, as a tinted label, filled by the share received (R-69).
  const partly =
    invoice.paymentStatus === API_PAYMENT_STATUSES.partiallyPaid ||
    invoice.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid;
  const received = invoice.deposits
    .filter((d) => !d.late)
    .reduce((sum, d) => sum + BigInt(d.amount), 0n);
  const share = Number((received * 1000n) / BigInt(invoice.amount)) / 1000;
  const steps = INVOICE_TIMELINE.map((step, i) => {
    const partlyPaid = partly && step === INVOICE_STEPS.paid;
    return {
      label: partlyPaid ? COPY.partlyPaid : COPY.steps[step],
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
            progress: confirming ? confirmingProgress(blocksLeft, next) : partlyPaid ? share : null,
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
 * "Confirming (4/12) · about 19 min left": blocks passed of the most left seen on this page, as the timeline's bar
 * counts them (the API gives no starting count).
 */
export function ConfirmingStatus({ blocks, seconds }: { blocks: number; seconds: number }) {
  const [most, setMost] = useState(blocks);
  if (blocks > most) setMost(blocks);
  const total = Math.max(most, blocks);
  return <>{COPY.confirming(total - blocks, total, seconds)}</>;
}
