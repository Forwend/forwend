import { balanceHistorySchema, balancesSchema } from "@/features/balances/schemas/balances";
import type { BalanceHistory } from "@/features/balances/types/balance-history";
import type { Balances } from "@/features/balances/types/balances";
import { apiSlice } from "@/shared/api/api-slice";

export const balancesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getBalances: build.query<Balances, string>({
      query: (profileId) => `/v1/profiles/${encodeURIComponent(profileId)}/balances`,
      responseSchema: balancesSchema,
    }),
    getBalanceHistory: build.query<BalanceHistory, { profileId: string; days: number }>({
      query: ({ profileId, days }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/balance-history`,
        params: { days },
      }),
      responseSchema: balanceHistorySchema,
    }),
  }),
});

export const { useGetBalancesQuery, useGetBalanceHistoryQuery } = balancesApi;
