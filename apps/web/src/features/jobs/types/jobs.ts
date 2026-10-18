import type { PaymentStatus } from "@forwend/ui-web";
import type { z } from "zod";
import type {
  ACCEPT_FIELDS,
  JOB_FIELDS,
  PAYMENT_FIELDS,
  RECORD_EVENTS,
} from "@/features/jobs/constants/jobs";
import type {
  createJobBodySchema,
  jobPaymentSchema,
  jobSchema,
  jobSummarySchema,
  publicJobSchema,
} from "@/features/jobs/schemas/jobs";

export type Job = z.infer<typeof jobSchema>;
export type PublicJob = z.infer<typeof publicJobSchema>;
export type JobPayment = z.infer<typeof jobPaymentSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type CreateJobBody = z.infer<typeof createJobBodySchema>;

/** A payment's invoice status: the API's invoice status filter, which names a status pill. */
export type JobPaymentStatus = Extract<
  PaymentStatus,
  "open" | "paid" | "settled" | "expired" | "canceled"
>;

export type JobField = (typeof JOB_FIELDS)[keyof typeof JOB_FIELDS];
export type RecordEventKind = (typeof RECORD_EVENTS)[keyof typeof RECORD_EVENTS];

/** One dated event of a job's record (R-104); payment is set for the events of one payment. */
export interface RecordEvent {
  kind: RecordEventKind;
  at: string;
  payment?: JobPayment;
}
export type PaymentField = (typeof PAYMENT_FIELDS)[keyof typeof PAYMENT_FIELDS];
export type AcceptField = (typeof ACCEPT_FIELDS)[keyof typeof ACCEPT_FIELDS];

/** A payment row as typed on New job. */
export interface PaymentDraft {
  id: string;
  title: string;
  amount: string;
  dueDays: string;
}
