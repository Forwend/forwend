import type { TransactionsPage } from "@/features/transactions/transactions";
import { apiSlice } from "@/shared/api/api-slice";

export const transactionsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getTransactions: build.query<TransactionsPage, { profileId: string; limit: number }>({
      query: ({ profileId, limit }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/transactions`,
        params: { limit },
      }),
    }),
  }),
});

export const { useGetTransactionsQuery } = transactionsApi;
