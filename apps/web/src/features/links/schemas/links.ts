import { z } from "zod";
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
  linkId: z.guid(),
  slug: z.string().regex(/^[a-z0-9]{12}$/),
  storeId: z.guid().nullable(),
  visits: count,
  paid: count,
  createdAt: apiTime,
  updatedAt: apiTime,
});

/** GET /v1/profiles/{profileId}/links: newest first. */
export const linksSchema = z.object({ links: z.array(linkSchema) });
