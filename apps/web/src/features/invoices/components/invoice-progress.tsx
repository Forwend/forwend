"use client";

import { IconButton, PaymentTimeline, STEP_STATES, TONES, Tooltip } from "@forwend/ui-web";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { API_PAYMENT_STATUSES } from "@/features/activity/constants/activity";
import { INVOICE_STEPS, INVOICE_TIMELINE } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import {
  confirmingProgress,
  depositAmount,
  invoiceProgress,
} from "@/features/invoices/lib/invoices";
import type { Invoice, InvoiceStep } from "@/features/invoices/types/invoices";

export interface InvoiceTimelineProps {
  invoice: Invoice;
  label: string;
  waiting?: boolean;
  steps?: readonly InvoiceStep[];
}

/** Status timeline (R-73, R-68). `waiting` false shows no step in progress (a closed checkout). */
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

  // Partly paid shows on the Paid step (R-69), unless the next payment is still confirming.
  const partly =
    current !== INVOICE_STEPS.confirming &&
    (invoice.paymentStatus === API_PAYMENT_STATUSES.partiallyPaid ||
      invoice.paymentStatus === API_PAYMENT_STATUSES.expiredPartiallyPaid);
  const received = depositAmount(invoice, false);
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
      // The waiting step always moves, so it never reads as stuck.
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
  blocks?: number | null;
  total?: number | null;
  seconds?: number | null;
}

export function ConfirmingStatus({ blocks, total, seconds }: ConfirmingStatusProps) {
  const target = total != null && blocks != null ? Math.max(total, blocks) : 0;
  const done = Math.max(0, target - (blocks ?? 0));
  const hint = COPY.confirmingHint(seconds, target === 0 ? blocks : null);
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted">
      <span className="tabular-nums">{COPY.confirmingCount(done, target)}</span>
      {hint ? (
        <Tooltip content={hint}>
          <IconButton label={hint} size="xs">
            <Info aria-hidden className="size-3.5" />
          </IconButton>
        </Tooltip>
      ) : null}
    </span>
  );
}
