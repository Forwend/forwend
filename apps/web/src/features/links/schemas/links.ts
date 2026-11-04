import { z } from "zod";
import { PAY_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import { LINK_SLUG_PATTERN, LINK_STATES } from "@/features/links/constants/links";
import { storeBrandSchema } from "@/features/stores/schemas/stores";
import { apiTime, count, usdAmount } from "@/shared/schemas/api";

/** The PUT body (R-140). Amounts are USD decimals; a fixed link sends amountUsd, an open one minUsd and maxUsd. */
export const linkBodySchema = z.object({
  title: z.string(),
  storeId: z.guid().optional(),
  amountUsd: usdAmount.nullable(),
  minUsd: usdAmount.nullable(),
  maxUsd: usdAmount.nullable(),
  endsAt: apiTime.nullable(),
  maxPayments: count.nullable(),
  active: z.boolean(),
});

/** One payment link (apps/backend/api/openapi.yaml, PaymentLink); storeId is null for a freelancer. */
export const linkSchema = linkBodySchema.extend({
  livemode: z.boolean(),
  linkId: z.guid(),
  slug: z.string().regex(LINK_SLUG_PATTERN),
  storeId: z.guid().nullable(),
  visits: count,
  paid: count,
  reserved: count.optional(),
  ready: z.boolean().optional(),
  createdAt: apiTime,
  updatedAt: apiTime,
});

/** GET /v1/profiles/{profileId}/links: newest first. */
export const linksPageSchema = z.object({
  links: z.array(linkSchema),
  nextCursor: z.string().nullable(),
});

/** GET /v1/links/{slug}: the link as its payer sees it (R-142). payee is the billing name, null before it is saved. */
export const publicLinkSchema = z.object({
  version: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .optional(),
  livemode: z.boolean(),
  slug: z.string().regex(LINK_SLUG_PATTERN),
  title: z.string(),
  payee: z.string().nullable(),
  // A merchant store's branding (R-135); null for a freelancer.
  brand: storeBrandSchema.nullable(),
  amountUsd: usdAmount.nullable(),
  minUsd: usdAmount.nullable(),
  maxUsd: usdAmount.nullable(),
  state: z.enum(LINK_STATES),
});

/** POST /v1/links/{slug}/pay: the payer's new invoice's pay token (D-86). */
export const linkPaySchema = z.object({ payToken: z.string().regex(PAY_TOKEN_PATTERN) });

export const linkPayArgSchema = z.object({
  slug: z.string().regex(LINK_SLUG_PATTERN),
  amountUsd: usdAmount.nullable(),
  expectedAmountUsd: usdAmount,
  expectedVersion: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .optional(),
  idempotencyKey: z.string().min(1),
});
