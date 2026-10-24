import { z } from "zod";
import { apiTime } from "@/shared/schemas/api";

/** The PUT body (R-134). */
export const storeBodySchema = z.object({
  name: z.string(),
  defaultExpiresIn: z.number().int(),
  allowedOrigins: z.array(z.string()),
});

/** One store (apps/backend/api/openapi.yaml, Store); storeId is its project ID (D-31). */
export const storeSchema = storeBodySchema.extend({
  storeId: z.guid(),
  updatedAt: apiTime,
});

/** GET /v1/profiles/{profileId}/stores. */
export const storesSchema = z.object({ stores: z.array(storeSchema) });
