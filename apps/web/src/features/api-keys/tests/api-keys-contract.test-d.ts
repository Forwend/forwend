import type {
  apiKeyBodySchema,
  apiKeysSchema,
  newApiKeySchema,
} from "@/features/api-keys/schemas/api-keys";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type ApiKeysSchemasMatchTheSpec = [
  Check<Accepts<typeof apiKeysSchema, ApiAnswer<"/v1/profiles/{profileId}/keys", "get">>>,
  Check<Accepts<typeof newApiKeySchema, ApiAnswer<"/v1/profiles/{profileId}/keys", "post">>>,
  Check<Sends<typeof apiKeyBodySchema, ApiBody<"/v1/profiles/{profileId}/keys", "post">>>,
  Check<
    Accepts<typeof newApiKeySchema, ApiAnswer<"/v1/profiles/{profileId}/keys/{keyId}/roll", "post">>
  >,
];
