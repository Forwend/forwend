import { PAYMENT_STATUS } from "@forwend/ui-web";
import { formatUsd } from "@/features/balances/lib/balances";
import { JOB_LIMITS, PAYMENT_STEPS, RECORD_EVENTS } from "@/features/jobs/constants/jobs";
import type { JobPayment, PaymentStep, PublicJob, RecordEvent } from "@/features/jobs/types/jobs";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { usdCents } from "@/shared/lib/money";

// Exact cents as the API takes them; null below 1.00 or for anything else.
export function paymentCents(text: string): bigint | null {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text.trim())) return null;
  const cents = usdCents(text.trim());
  return cents < 100n ? null : cents;
}

export function dueDays(text: string): number | null {
  const days = /^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
  return days >= 0 && days <= JOB_LIMITS.dueDays ? days : null;
}

export function usdText(amountUsd: string): string {
  return `${formatUsd(usdCents(amountUsd))} ${MONEY_COPY.usd}`;
}

// A 422 names its field only in the message: "invalid job request: email must be …".
export function namedField<F extends string>(message: string, fields: readonly F[]): F | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return fields.find((field) => field === name) ?? null;
}

const RECORD_ORDER = Object.values(RECORD_EVENTS);

// Oldest first; an accept makes its invoice at the same time, so ties keep their order.
export function jobRecord(job: PublicJob): RecordEvent[] {
  const events: RecordEvent[] = [{ kind: RECORD_EVENTS.created, at: job.createdAt }];
  if (job.acceptedAt) events.push({ kind: RECORD_EVENTS.accepted, at: job.acceptedAt });
  for (const payment of job.payments) {
    if (payment.proposedAt)
      events.push({ kind: RECORD_EVENTS.proposed, at: payment.proposedAt, payment });
    if (payment.proposedAt && payment.acceptedAt)
      events.push({ kind: RECORD_EVENTS.changeAccepted, at: payment.acceptedAt, payment });
    if (payment.doneAt) events.push({ kind: RECORD_EVENTS.done, at: payment.doneAt, payment });
    if (payment.invoicedAt)
      events.push({ kind: RECORD_EVENTS.invoiced, at: payment.invoicedAt, payment });
    if (payment.paidAt) events.push({ kind: RECORD_EVENTS.paid, at: payment.paidAt, payment });
  }
  return events.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      RECORD_ORDER.indexOf(a.kind) - RECORD_ORDER.indexOf(b.kind) ||
      (a.payment?.position ?? 0) - (b.payment?.position ?? 0),
  );
}

// Not accepted yet: it can't be marked done and stays out of the total.
export function isPendingChange(payment: JobPayment): boolean {
  return payment.proposedAt !== null && payment.acceptedAt === null;
}

export function paymentStep(payment: JobPayment): PaymentStep {
  if (isPendingChange(payment)) return PAYMENT_STEPS.change;
  if (payment.status === PAYMENT_STATUS.paid || payment.status === PAYMENT_STATUS.settled)
    return PAYMENT_STEPS.paid;
  return payment.invoiceId ? PAYMENT_STEPS.invoiced : PAYMENT_STEPS.upcoming;
}
