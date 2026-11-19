import { PRICES_KEEP_S } from "@/features/prices/constants/prices";
import { pricesSchema } from "@/features/prices/schemas/prices";
import type { Prices } from "@/features/prices/types/prices";
import { apiSlice } from "@/shared/api/api-slice";

export const pricesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getPrices: build.query<Prices, void>({
      query: () => "/v1/prices",
      responseSchema: pricesSchema,
      keepUnusedDataFor: PRICES_KEEP_S,
    }),
  }),
});

export const { useGetPricesQuery } = pricesApi;
