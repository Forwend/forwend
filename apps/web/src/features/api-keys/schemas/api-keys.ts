import { z } from "zod";
import { KEY_SCOPES } from "@/features/api-keys/constants/api-keys";
import { apiTime } from "@/shared/schemas/api";

export const apiKeySchema = z.object({
  keyId: z.guid(),
  name: z.string(),
  storeId: z.guid().nullable(), // null for a freelancer's key
  livemode: z.boolean(),
  last4: z.string().regex(/^[0-9A-Za-z]{4}$/),
  scopes: z.array(z.enum(KEY_SCOPES)),
  createdAt: apiTime,
  lastUsedAt: apiTime.nullable(),
  expiresAt: apiTime.nullable(), // set once rolled
});

export const apiKeysSchema = z.object({ keys: z.array(apiKeySchema) });

export const newApiKeySchema = apiKeySchema.extend({
  secret: z.string().regex(/^fw_(test|live)_[0-9A-Za-z]{36}$/),
});

export const apiKeyBodySchema = z.object({
  name: z.string(),
  storeId: z.guid().optional(),
  scopes: z.array(z.enum(KEY_SCOPES)).min(1),
});
