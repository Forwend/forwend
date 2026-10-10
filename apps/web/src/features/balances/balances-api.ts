import type { Balances } from "@/features/balances/balances";
import { apiSlice } from "@/shared/api/api-slice";

export const balancesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getBalances: build.query<Balances, string>({
      query: (profileId) => `/v1/profiles/${encodeURIComponent(profileId)}/balances`,
    }),
  }),
});

export const { useGetBalancesQuery } = balancesApi;
