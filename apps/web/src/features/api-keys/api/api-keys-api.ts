import { z } from "zod";
import {
  apiKeyBodySchema,
  apiKeysSchema,
  newApiKeySchema,
} from "@/features/api-keys/schemas/api-keys";
import type { ApiKey, ApiKeyBody, NewApiKey } from "@/features/api-keys/types/api-keys";
import { apiSlice } from "@/shared/api/api-slice";

const KEYS_TAG = "ApiKeys";

const keysUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/keys`;

// R-144: making or rolling a key asks for a fresh sign-in first when the last one is older than 5 minutes (D-63).
export const apiKeysApi = apiSlice.enhanceEndpoints({ addTagTypes: [KEYS_TAG] }).injectEndpoints({
  endpoints: (build) => ({
    listKeys: build.query<ApiKey[], string>({
      query: (profileId) => keysUrl(profileId),
      rawResponseSchema: apiKeysSchema,
      transformResponse: (data: { keys: ApiKey[] }) => data.keys,
      providesTags: [KEYS_TAG],
    }),
    createKey: build.mutation<NewApiKey, { profileId: string; body: ApiKeyBody }>({
      query: ({ profileId, body }) => ({ url: keysUrl(profileId), method: "POST", body }),
      argSchema: z.object({ profileId: z.guid(), body: apiKeyBodySchema }),
      responseSchema: newApiKeySchema,
      invalidatesTags: [KEYS_TAG],
    }),
    rollKey: build.mutation<NewApiKey, { profileId: string; keyId: string; overlapHours: number }>({
      query: ({ profileId, keyId, overlapHours }) => ({
        url: `${keysUrl(profileId)}/${encodeURIComponent(keyId)}/roll`,
        method: "POST",
        body: { overlapHours },
      }),
      argSchema: z.object({
        profileId: z.guid(),
        keyId: z.guid(),
        overlapHours: z.number().int().min(0).max(168),
      }),
      responseSchema: newApiKeySchema,
      invalidatesTags: [KEYS_TAG],
    }),
    revokeKey: build.mutation<void, { profileId: string; keyId: string }>({
      query: ({ profileId, keyId }) => ({
        url: `${keysUrl(profileId)}/${encodeURIComponent(keyId)}`,
        method: "DELETE",
      }),
      invalidatesTags: [KEYS_TAG],
    }),
  }),
});

export const { useListKeysQuery, useCreateKeyMutation, useRollKeyMutation, useRevokeKeyMutation } =
  apiKeysApi;
