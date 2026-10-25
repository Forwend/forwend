import { z } from "zod";
import { tokenRefSchema } from "@/features/profiles/schemas/profiles";
import { BRAND_COLOR_PATTERN } from "@/features/stores/constants/stores";
import { apiTime } from "@/shared/schemas/api";

/** The PUT body (R-134); brandColor is "#rrggbb" or "" for none (R-135). */
export const storeBodySchema = z.object({
  name: z.string(),
  defaultExpiresIn: z.number().int(),
  allowedOrigins: z.array(z.string()),
  brandColor: z.string().regex(BRAND_COLOR_PATTERN),
  // More tokens off for the store's invoices than the profile has off (R-136).
  tokensOff: z.array(tokenRefSchema),
});

/** One store (apps/backend/api/openapi.yaml, Store); storeId is its project ID (D-31). */
export const storeSchema = storeBodySchema.extend({
  storeId: z.guid(),
  brandColor: z.string().regex(BRAND_COLOR_PATTERN).nullable(),
  // When the logo was saved; null without one (R-135).
  logoAt: apiTime.nullable(),
  updatedAt: apiTime,
});

/** A store's branding as its checkouts show it (R-135): the logo is at /v1/stores/{storeId}/logo.png once saved. */
export const storeBrandSchema = z.object({
  storeId: z.guid(),
  color: z.string().regex(BRAND_COLOR_PATTERN).nullable(),
  logoAt: apiTime.nullable(),
});

/** GET /v1/profiles/{profileId}/stores. */
export const storesSchema = z.object({ stores: z.array(storeSchema) });
