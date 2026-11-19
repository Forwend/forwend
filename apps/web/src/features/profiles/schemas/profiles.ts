import { z } from "zod";
import { FEES_PAID_BY, PROFILE_KINDS, ROLES } from "@/features/profiles/constants/profile";
import { apiTime, count, evmAddress } from "@/shared/schemas/api";

export const profileSchema = z.object({
  profileId: z.guid(),
  kind: z.enum(PROFILE_KINDS),
  name: z.string().nullable(),
  walletAddress: evmAddress.nullable(),
  createdAt: apiTime,
  role: z.enum(ROLES),
  permissions: z.array(z.string()),
  livemode: z.boolean(), // false in Developer mode
  feesPaidBy: z.enum(FEES_PAID_BY).optional(), // absent: the owner pays
});

export const profileModeSchema = z.object({ livemode: z.boolean() });

export const profileFeesSchema = z.object({ feesPaidBy: z.enum(FEES_PAID_BY) });

export const meSchema = z.object({
  onboardedAt: apiTime.nullable(), // null until the first run is done
  profiles: z.array(profileSchema),
});

export const createProfileBodySchema = z.object({
  kind: z.enum(PROFILE_KINDS),
  name: z.string(),
});

export const billingDetailsBodySchema = z.object({
  name: z.string(),
  address: z.string(),
  country: z.string().regex(/^[A-Z]{2}$/),
  taxId: z.string().nullable(),
  email: z.string(),
});

export const billingDetailsSchema = billingDetailsBodySchema.extend({ updatedAt: apiTime });

export const tokenRefSchema = z.object({ chainId: count, token: evmAddress });

export const profileTokensSchema = z.object({
  tokens: z.array(
    tokenRefSchema.extend({
      symbol: z.string(),
      decimals: count,
      network: z.string(),
      on: z.boolean(),
    }),
  ),
});

export const notificationsSchema = z.object({
  email: z.boolean(),
  address: z.string().nullable(), // null when the account has no email
});
