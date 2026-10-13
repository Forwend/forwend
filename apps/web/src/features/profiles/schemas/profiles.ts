import { z } from "zod";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { apiTime, evmAddress } from "@/shared/schemas/api";

/** One profile as the API returns it (apps/backend/api/openapi.yaml, Profile). */
export const profileSchema = z.object({
  profileId: z.guid(),
  kind: z.enum(PROFILE_KINDS),
  name: z.string().nullable(),
  walletAddress: evmAddress.nullable(),
  createdAt: apiTime,
});

/** POST and GET /v1/me, and POST /v1/me/onboarding. */
export const meSchema = z.object({
  // When the user made or skipped the first-run choice; null shows it.
  onboardedAt: apiTime.nullable(),
  profiles: z.array(profileSchema),
});

/** POST /v1/profiles. */
export const createProfileBodySchema = z.object({
  kind: z.enum(PROFILE_KINDS),
  name: z.string(),
});

/** The PUT /v1/profiles/{profileId}/billing-details body. */
export const billingDetailsBodySchema = z.object({
  name: z.string(),
  address: z.string(),
  // ISO 3166-1 alpha-2, upper case.
  country: z.string().regex(/^[A-Z]{2}$/),
  taxId: z.string().nullable(),
  email: z.string(),
});

/** GET /v1/profiles/{profileId}/billing-details. */
export const billingDetailsSchema = billingDetailsBodySchema.extend({ updatedAt: apiTime });
