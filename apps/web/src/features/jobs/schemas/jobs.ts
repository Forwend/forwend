import { z } from "zod";
import { clientBodySchema } from "@/features/clients/schemas/clients";
import { PAY_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import { JOB_TOKEN_PATTERN } from "@/features/jobs/constants/jobs";
import type { JobPaymentStatus } from "@/features/jobs/types/jobs";
import { apiTime, hash32, openEnum, pageOf } from "@/shared/schemas/api";

const usdCents = z.string().regex(/^\d+\.\d{2}$/);

export const jobPaymentSchema = z.object({
  position: z.number().int().positive(),
  title: z.string(),
  amountUsd: usdCents,
  dueDays: z.number().int().nonnegative(),
  onAccept: z.boolean(),
  invoiceId: hash32.nullable(),
  payToken: z.string().regex(PAY_TOKEN_PATTERN).nullable(),
  number: z.number().int().positive().nullable(),
  status: openEnum<JobPaymentStatus>().nullable(),
  doneAt: apiTime.nullable(),
  deliveryLink: z.string().nullable(),
  invoicedAt: apiTime.nullable(),
  paidAt: apiTime.nullable(),
  proposedAt: apiTime.nullable(), // accept sends back this exact string
  acceptedName: z.string().nullable(),
  acceptedAt: apiTime.nullable(),
});

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

export const jobSchema = publicJobSchema.extend({
  payments: z.array(
    jobPaymentSchema.extend({ acceptedEmail: z.string().nullable(), clientEmailed: z.boolean() }),
  ),
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

export const jobsPageSchema = pageOf(jobSummarySchema);

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
