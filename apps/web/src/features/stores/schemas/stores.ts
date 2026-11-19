import { z } from "zod";
import { tokenRefSchema } from "@/features/profiles/schemas/profiles";
import { BRAND_COLOR_PATTERN } from "@/features/stores/constants/stores";
import { apiTime } from "@/shared/schemas/api";

export const storeBodySchema = z.object({
  name: z.string(),
  defaultExpiresIn: z.number().int(),
  allowedOrigins: z.array(z.string()),
  brandColor: z.string().regex(BRAND_COLOR_PATTERN),
  tokensOff: z.array(tokenRefSchema),
});

export const storeSchema = storeBodySchema.extend({
  storeId: z.guid(), // the project ID
  brandColor: z.string().regex(BRAND_COLOR_PATTERN).nullable(),
  logoAt: apiTime.nullable(), // null without a logo
  updatedAt: apiTime,
});

export const storeBrandSchema = z.object({
  storeId: z.guid(),
  color: z.string().regex(BRAND_COLOR_PATTERN).nullable(),
  logoAt: apiTime.nullable(),
});

export const storesSchema = z.object({ stores: z.array(storeSchema) });
