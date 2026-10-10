import type { BalanceHistory } from "@/features/balances/balance-history";
import type { Balances } from "@/features/balances/balances";
import { apiSlice } from "@/shared/api/api-slice";

export const balancesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getBalances: build.query<Balances, string>({
      query: (profileId) => `/v1/profiles/${encodeURIComponent(profileId)}/balances`,
    }),
    getBalanceHistory: build.query<BalanceHistory, { profileId: string; days: number }>({
      query: ({ profileId, days }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/balance-history`,
        params: { days },
      }),
    }),
  }),
});

export const { useGetBalancesQuery, useGetBalanceHistoryQuery } = balancesApi;
