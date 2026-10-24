import { z } from "zod";
import { BRAND_COLOR_PATTERN } from "@/features/stores/constants/stores";
import { apiTime } from "@/shared/schemas/api";

/** The PUT body (R-134); brandColor is "#rrggbb" or "" for none (R-135). */
export const storeBodySchema = z.object({
  name: z.string(),
  defaultExpiresIn: z.number().int(),
  allowedOrigins: z.array(z.string()),
  brandColor: z.string().regex(BRAND_COLOR_PATTERN),
});

/** One store (apps/backend/api/openapi.yaml, Store); storeId is its project ID (D-31). */
export const storeSchema = storeBodySchema.extend({
  storeId: z.guid(),
  brandColor: z.string().regex(BRAND_COLOR_PATTERN).nullable(),
  // When the logo was saved; null without one (R-135).
  logoAt: apiTime.nullable(),
  updatedAt: apiTime,
});

/** GET /v1/profiles/{profileId}/stores. */
export const storesSchema = z.object({ stores: z.array(storeSchema) });
