import { JOB_FIELDS, JOB_LIMITS, RECORD_EVENTS } from "@/features/jobs/constants/jobs";
import type { JobField, JobSummary, PublicJob, RecordEvent } from "@/features/jobs/types/jobs";
import { foldText } from "@/shared/lib/search";

/**
 * A typed USD amount in cents, exact: digits with at most 2 decimals and at most 10 whole digits, as the API takes it
 * (R-100). Null when it isn't one or is 0.
 */
export function usdCents(text: string): bigint | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt((match[1] ?? "") + (match[2] ?? "").padEnd(2, "0"));
  return cents === 0n ? null : cents;
}

/** Typed days to pay: a whole number from 0 to the API's limit, or null. */
export function dueDays(text: string): number | null {
  const days = /^\d{1,2}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
  return days >= 0 && days <= JOB_LIMITS.dueDays ? days : null;
}

/** The API's amount text for cents: "300.00". */
export function centsText(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** The API's "300.00" in cents. */
export function apiCents(amountUsd: string): bigint {
  return BigInt(amountUsd.replace(".", ""));
}

/** The field of fields a refused request names: the API's message reads "invalid job request: email must be …". */
export function namedField<F extends string>(message: string, fields: readonly F[]): F | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return fields.find((field) => field === name) ?? null;
}

/** The field a refused create names. */
export function invalidJobField(message: string): JobField | null {
  return namedField(message, Object.values(JOB_FIELDS));
}

/** Whether a job matches the list's search: its title or client, ignoring case and accents. */
export function matchesJob(job: JobSummary, search: string): boolean {
  return foldText(`${job.title} ${job.clientName}`).includes(foldText(search.trim()));
}

const RECORD_ORDER = Object.values(RECORD_EVENTS);

/**
 * A job's record (R-104): the quote made, its acceptance, then each payment's step done, invoice made and payment, by
 * time, oldest first. Events at the same time keep the order they happen in: acceptance or a step done makes its
 * invoice in the same transaction.
 */
export function jobRecord(job: PublicJob): RecordEvent[] {
  const events: RecordEvent[] = [{ kind: RECORD_EVENTS.created, at: job.createdAt }];
  if (job.acceptedAt) events.push({ kind: RECORD_EVENTS.accepted, at: job.acceptedAt });
  for (const payment of job.payments) {
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
