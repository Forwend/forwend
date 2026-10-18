import { JOB_FIELDS, JOB_LIMITS } from "@/features/jobs/constants/jobs";
import type { JobField, JobSummary } from "@/features/jobs/types/jobs";
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
