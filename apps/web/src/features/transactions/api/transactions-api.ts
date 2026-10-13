import type {
  TransactionDirection,
  TransactionsPage,
} from "@/features/transactions/types/transactions";
import { apiSlice } from "@/shared/api/api-slice";

export const transactionsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** In one direction and under the search when given. */
    getTransactions: build.query<
      TransactionsPage,
      { profileId: string; limit: number; direction?: TransactionDirection; q?: string }
    >({
      query: ({ profileId, ...params }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/transactions`,
        params,
      }),
    }),
  }),
});

export const { useGetTransactionsQuery } = transactionsApi;
