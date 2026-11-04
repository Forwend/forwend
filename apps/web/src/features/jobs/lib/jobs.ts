import { PAYMENT_STATUS } from "@forwend/ui-web";
import {
  JOB_FIELDS,
  JOB_LIMITS,
  PAYMENT_STEPS,
  RECORD_EVENTS,
} from "@/features/jobs/constants/jobs";
import type {
  JobField,
  JobPayment,
  PaymentStep,
  PublicJob,
  RecordEvent,
} from "@/features/jobs/types/jobs";

/** Exact, as the API takes it (R-100); null when it isn't one or is 0. */
export function usdCents(text: string): bigint | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt((match[1] ?? "") + (match[2] ?? "").padEnd(2, "0"));
  // R-56: each payment's invoice asks for at least 1.00 USD.
  return cents < 100n ? null : cents;
}

export function dueDays(text: string): number | null {
  const days = /^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
  return days >= 0 && days <= JOB_LIMITS.dueDays ? days : null;
}

export function centsText(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** The API always sends 2 decimals ("300.00"), so dropping the point gives cents. */
export function apiCents(amountUsd: string): bigint {
  return BigInt(amountUsd.replace(".", ""));
}

/** The API's 422 names the field only in its message: "invalid job request: email must be …". */
export function namedField<F extends string>(message: string, fields: readonly F[]): F | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return fields.find((field) => field === name) ?? null;
}

export function invalidJobField(message: string): JobField | null {
  return namedField(message, Object.values(JOB_FIELDS));
}

const RECORD_ORDER = Object.values(RECORD_EVENTS);

/** R-104, oldest first. Events at one time keep their order: an accept makes its invoice in the same transaction. */
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

/** A scope change the client has not accepted yet (R-105): it can't be marked done and stays out of the total. */
export function isPendingChange(payment: JobPayment): boolean {
  return payment.proposedAt !== null && payment.acceptedAt === null;
}

/** A paid invoice is done; a made one is the step under way. */
export function paymentStep(payment: JobPayment): PaymentStep {
  if (isPendingChange(payment)) return PAYMENT_STEPS.change;
  if (payment.status === PAYMENT_STATUS.paid || payment.status === PAYMENT_STATUS.settled)
    return PAYMENT_STEPS.paid;
  return payment.invoiceId ? PAYMENT_STEPS.invoiced : PAYMENT_STEPS.upcoming;
}
