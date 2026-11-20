import { z } from "zod";
import { PAY_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import {
  LINK_SLUG_PATTERN,
  LINK_STATES,
  OFFER_VERSION_PATTERN,
} from "@/features/links/constants/links";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";
import { storeBrandSchema } from "@/features/stores/schemas/stores";
import { apiTime, count, usdAmount } from "@/shared/schemas/api";

export const linkBodySchema = z.object({
  title: z.string(),
  storeId: z.guid().optional(),
  amountUsd: usdAmount.nullable(),
  minUsd: usdAmount.nullable(),
  maxUsd: usdAmount.nullable(),
  endsAt: apiTime.nullable(),
  maxPayments: count.nullable(),
  active: z.boolean(),
  feesPaidBy: z.enum(FEES_PAID_BY).nullable().optional(), // null: the profile's choice
});

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

export const linksPageSchema = z.object({
  links: z.array(linkSchema),
  nextCursor: z.string().nullable(),
});

export const publicLinkSchema = z.object({
  version: z.string().regex(OFFER_VERSION_PATTERN).optional(),
  livemode: z.boolean(),
  slug: z.string().regex(LINK_SLUG_PATTERN),
  title: z.string(),
  payee: z.string().nullable(),
  brand: storeBrandSchema.nullable(),
  amountUsd: usdAmount.nullable(),
  minUsd: usdAmount.nullable(),
  maxUsd: usdAmount.nullable(),
  state: z.enum(LINK_STATES),
});

export const linkPaySchema = z.object({ payToken: z.string().regex(PAY_TOKEN_PATTERN) });

export const linkPayArgSchema = z.object({
  slug: z.string().regex(LINK_SLUG_PATTERN),
  amountUsd: usdAmount.nullable(),
  expectedAmountUsd: usdAmount,
  expectedVersion: z.string().regex(OFFER_VERSION_PATTERN).optional(),
  idempotencyKey: z.string().min(1),
});
