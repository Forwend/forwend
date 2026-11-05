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
    /** 404 for another profile's store, or one outside a scoped member's stores (D-93). */
    getStore: build.query<Store, { profileId: string; storeId: string }>({
      query: ({ profileId, storeId }) => `${storesUrl(profileId)}/${encodeURIComponent(storeId)}`,
      responseSchema: storeSchema,
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
    /** R-135: the body is the image file itself. */
    saveStoreLogo: build.mutation<Store, { profileId: string; storeId: string; logo: File }>({
      query: ({ profileId, storeId, logo }) => ({
        url: `${storesUrl(profileId)}/${encodeURIComponent(storeId)}/logo`,
        method: "PUT",
        body: logo,
        headers: { "Content-Type": logo.type },
      }),
      responseSchema: storeSchema,
      invalidatesTags: [STORES_TAG],
    }),
    deleteStoreLogo: build.mutation<Store, { profileId: string; storeId: string }>({
      query: ({ profileId, storeId }) => ({
        url: `${storesUrl(profileId)}/${encodeURIComponent(storeId)}/logo`,
        method: "DELETE",
      }),
      responseSchema: storeSchema,
      invalidatesTags: [STORES_TAG],
    }),
  }),
});

export const {
  useListStoresQuery,
  useLazyListStoresQuery,
  useGetStoreQuery,
  useSaveStoreMutation,
  useSaveStoreLogoMutation,
  useDeleteStoreLogoMutation,
} = storesApi;
