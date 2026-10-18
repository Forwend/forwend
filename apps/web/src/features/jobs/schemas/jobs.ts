import { z } from "zod";
import { clientBodySchema } from "@/features/clients/schemas/clients";
import { JOB_TOKEN_PATTERN } from "@/features/jobs/constants/jobs";
import type { JobPaymentStatus } from "@/features/jobs/types/jobs";
import { apiTime, hash32, openEnum } from "@/shared/schemas/api";

const usdCents = z.string().regex(/^\d+\.\d{2}$/);

/** One payment of the schedule (R-100); invoiceId, number and status are null until its invoice is made. */
export const jobPaymentSchema = z.object({
  position: z.number().int().positive(),
  title: z.string(),
  amountUsd: usdCents,
  dueDays: z.number().int().nonnegative(),
  onAccept: z.boolean(),
  invoiceId: hash32.nullable(),
  number: z.number().int().positive().nullable(),
  status: openEnum<JobPaymentStatus>().nullable(),
});

/** GET /v1/jobs/{token}: the job as its client's link shows it. */
export const publicJobSchema = z.object({
  title: z.string(),
  scope: z.string().nullable(),
  issuer: z.object({
    name: z.string(),
    address: z.string(),
    country: z.string(),
    taxId: z.string().nullable(),
    email: z.string(),
  }),
  payments: z.array(jobPaymentSchema),
  totalUsd: usdCents,
  acceptedName: z.string().nullable(),
  acceptedAt: apiTime.nullable(),
  createdAt: apiTime,
});

/** The owner's read: the public view plus its id, link token, client and the client's typed email. */
export const jobSchema = publicJobSchema.extend({
  jobId: z.guid(),
  token: z.string().regex(JOB_TOKEN_PATTERN),
  client: z.object({
    name: z.string(),
    email: z.string(),
    address: z.string().nullable(),
    country: z.string().nullable(),
    taxId: z.string().nullable(),
  }),
  acceptedEmail: z.string().nullable(),
});

export const jobSummarySchema = z.object({
  jobId: z.guid(),
  title: z.string(),
  clientName: z.string(),
  totalUsd: usdCents,
  payments: z.number().int().positive(),
  paid: z.number().int().nonnegative(),
  acceptedAt: apiTime.nullable(),
  createdAt: apiTime,
});

/** GET /v1/profiles/{profileId}/jobs. */
export const jobsSchema = z.object({ items: z.array(jobSummarySchema) });

/** POST /v1/profiles/{profileId}/jobs. */
export const createJobBodySchema = z.object({
  title: z.string(),
  scope: z.string(),
  client: clientBodySchema,
  payments: z.array(
    z.object({
      title: z.string(),
      amountUsd: z.string(),
      dueDays: z.number().int(),
      onAccept: z.boolean(),
    }),
  ),
});
