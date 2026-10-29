import type { PaymentStatus } from "@forwend/ui-web";
import type { z } from "zod";
import type {
  ACCEPT_FIELDS,
  JOB_FIELDS,
  PAYMENT_FIELDS,
  PAYMENT_STEPS,
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

/** The API's invoice status filter values. */
export type JobPaymentStatus = Extract<
  PaymentStatus,
  "open" | "paid" | "settled" | "expired" | "canceled"
>;

export type JobField = (typeof JOB_FIELDS)[keyof typeof JOB_FIELDS];
export type RecordEventKind = (typeof RECORD_EVENTS)[keyof typeof RECORD_EVENTS];

/** R-104; payment is set for the events of one payment. */
export interface RecordEvent {
  kind: RecordEventKind;
  at: string;
  payment?: JobPayment;
}
export type PaymentField = (typeof PAYMENT_FIELDS)[keyof typeof PAYMENT_FIELDS];
export type PaymentStep = (typeof PAYMENT_STEPS)[keyof typeof PAYMENT_STEPS];
export type AcceptField = (typeof ACCEPT_FIELDS)[keyof typeof ACCEPT_FIELDS];

export interface PaymentDraft {
  id: string;
  title: string;
  amount: string;
  dueDays: string;
}
