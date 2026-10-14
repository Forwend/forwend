"use client";

import { IconButton, PaymentTimeline, STEP_STATES, TONES, Tooltip } from "@forwend/ui-web";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { API_PAYMENT_STATUSES } from "@/features/activity/constants/activity";
import { INVOICE_STEPS, INVOICE_TIMELINE } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { confirmingProgress, invoiceProgress } from "@/features/invoices/lib/invoices";
import type { Invoice, InvoiceStep } from "@/features/invoices/types/invoices";

export interface InvoiceTimelineProps {
  invoice: Invoice;
  label: string;
  waiting?: boolean;
  steps?: readonly InvoiceStep[];
}

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
}: InvoiceTimelineProps) {
  const { done: reached, current, blocksLeft, blocksTotal } = invoiceProgress(invoice);
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
    const label = partlyPaid
      ? COPY.partlyPaid
      : step === INVOICE_STEPS.confirming && i < done
        ? COPY.confirmed
        : COPY.steps[step];
    return {
      label,
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

export interface ConfirmingStatusProps {
  blocks: number;
  total: number;
  seconds: number;
}

export function ConfirmingStatus({ blocks, total, seconds }: ConfirmingStatusProps) {
  const done = Math.max(0, total - blocks);
  const target = Math.max(total, blocks);
  const hint = COPY.confirmingHint(seconds);
  return (
    <span className="flex items-center gap-1 text-sm text-muted">
      <span aria-hidden="true" className="tabular-nums">
        {COPY.confirmingCount(done, target)}
      </span>
      <Tooltip content={hint}>
        <IconButton label={hint} size="xs">
          <Clock aria-hidden className="size-3.5" />
        </IconButton>
      </Tooltip>
      <span className="sr-only">{COPY.confirming(done, target, seconds)}</span>
    </span>
  );
}
