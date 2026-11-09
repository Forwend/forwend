import { z } from "zod";
import { FEES_PAID_BY, PROFILE_KINDS, ROLES } from "@/features/profiles/constants/profile";
import { apiTime, count, evmAddress } from "@/shared/schemas/api";

/** One profile as the API returns it (apps/backend/api/openapi.yaml, Profile). */
export const profileSchema = z.object({
  profileId: z.guid(),
  kind: z.enum(PROFILE_KINDS),
  name: z.string().nullable(),
  walletAddress: evmAddress.nullable(),
  createdAt: apiTime,
  // R-138: the user's role here, and its permissions; one the app doesn't know yet is kept and never matches.
  role: z.enum(ROLES),
  permissions: z.array(z.string()),
  // D-120: false while the profile is in Developer mode, on the testnets.
  livemode: z.boolean(),
  // D-122: who pays new invoices' fees unless one says otherwise; an answer without it has the owner pay.
  feesPaidBy: z.enum(FEES_PAID_BY).optional(),
});

/** PUT /v1/profiles/{profileId}/mode. */
export const profileModeSchema = z.object({ livemode: z.boolean() });

/** PUT /v1/profiles/{profileId}/fees. */
export const profileFeesSchema = z.object({ feesPaidBy: z.enum(FEES_PAID_BY) });

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

/** A token by its chain and contract (R-136). */
export const tokenRefSchema = z.object({ chainId: count, token: evmAddress });

/** GET and PUT /v1/profiles/{id}/tokens (R-136): every enabled token, on until the profile turns it off. */
export const profileTokensSchema = z.object({
  tokens: z.array(
    tokenRefSchema.extend({
      symbol: z.string(),
      decimals: count,
      network: z.string(),
      on: z.boolean(),
    }),
  ),
  // R-240: payers may pay from other chains through NEAR Intents; an older api leaves it out.
  crossChain: z.boolean().optional(),
});

/** GET and PUT /v1/profiles/{id}/notifications (R-80); a null address means none. */
export const notificationsSchema = z.object({
  email: z.boolean(),
  address: z.string().nullable(),
});
