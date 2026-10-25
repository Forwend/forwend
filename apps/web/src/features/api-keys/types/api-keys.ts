import type { z } from "zod";
import type { KEY_SCOPES } from "@/features/api-keys/constants/api-keys";
import type {
  apiKeyBodySchema,
  apiKeySchema,
  newApiKeySchema,
} from "@/features/api-keys/schemas/api-keys";

export type ApiKey = z.infer<typeof apiKeySchema>;

export type NewApiKey = z.infer<typeof newApiKeySchema>;

export type ApiKeyBody = z.infer<typeof apiKeyBodySchema>;

export type KeyScope = (typeof KEY_SCOPES)[number];
