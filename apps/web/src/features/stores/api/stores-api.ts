import { z } from "zod";
import { storeBodySchema, storeSchema, storesSchema } from "@/features/stores/schemas/stores";
import type { Store, StoreBody } from "@/features/stores/types/stores";
import { apiSlice } from "@/shared/api/api-slice";

const STORES_TAG = "Stores";

const storesUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/stores`;

export const storesApi = apiSlice.enhanceEndpoints({ addTagTypes: [STORES_TAG] }).injectEndpoints({
  endpoints: (build) => ({
    /** At most 20, the first store first. */
    listStores: build.query<Store[], string>({
      query: (profileId) => storesUrl(profileId),
      rawResponseSchema: storesSchema,
      transformResponse: (data: { stores: Store[] }) => data.stores,
      providesTags: [STORES_TAG],
    }),
    /** PUT to an id the browser picks, so a retried save makes one store (R-134). */
    saveStore: build.mutation<Store, { profileId: string; storeId: string; body: StoreBody }>({
      query: ({ profileId, storeId, body }) => ({
        url: `${storesUrl(profileId)}/${encodeURIComponent(storeId)}`,
        method: "PUT",
        body,
      }),
      argSchema: z.object({ profileId: z.guid(), storeId: z.guid(), body: storeBodySchema }),
      responseSchema: storeSchema,
      invalidatesTags: [STORES_TAG],
    }),
  }),
});

export const { useListStoresQuery, useSaveStoreMutation } = storesApi;
