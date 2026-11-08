import { z } from "zod";
import { KEY_SCOPES } from "@/features/api-keys/constants/api-keys";
import { apiTime } from "@/shared/schemas/api";

/** One secret API key (apps/backend/api/openapi.yaml, ApiKey); never its text. */
export const apiKeySchema = z.object({
  keyId: z.guid(),
  name: z.string(),
  // A merchant key's store; null for a freelancer's.
  storeId: z.guid().nullable(),
  livemode: z.boolean(),
  last4: z.string().regex(/^[0-9A-Za-z]{4}$/),
  scopes: z.array(z.enum(KEY_SCOPES)),
  createdAt: apiTime,
  lastUsedAt: apiTime.nullable(),
  // Set once rolled: the key works until then.
  expiresAt: apiTime.nullable(),
});

/** GET /v1/profiles/{profileId}/keys: the working keys, newest first. */
export const apiKeysSchema = z.object({ keys: z.array(apiKeySchema) });

/** A made or rolled key: the one answer with its text. */
export const newApiKeySchema = apiKeySchema.extend({
  secret: z.string().regex(/^fw_(test|live)_[0-9A-Za-z]{36}$/),
});

export const apiKeyBodySchema = z.object({
  name: z.string(),
  storeId: z.guid().optional(),
  scopes: z.array(z.enum(KEY_SCOPES)).min(1),
});
