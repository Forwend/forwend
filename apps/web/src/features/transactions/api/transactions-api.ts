import { transactionsPageSchema } from "@/features/transactions/schemas/transactions";
import type {
  Transaction,
  TransactionDirection,
  TransactionLabel,
  TransactionsPage,
} from "@/features/transactions/types/transactions";
import { apiSlice } from "@/shared/api/api-slice";

const TRANSACTIONS_TAG = "Transactions";

export const transactionsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [TRANSACTIONS_TAG] })
  .injectEndpoints({
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
        responseSchema: transactionsPageSchema,
        providesTags: [TRANSACTIONS_TAG],
      }),
      /** Labels money in that Forwend can't classify (R-108); null clears the label. */
      labelTransaction: build.mutation<
        void,
        { profileId: string; transaction: Transaction; label: TransactionLabel | null }
      >({
        query: ({ profileId, transaction: t, label }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/transactions/${t.chainId}/${t.txHash}/${t.logIndex}/label`,
          method: "PUT",
          body: { label },
        }),
        invalidatesTags: [TRANSACTIONS_TAG],
      }),
      /** Every transaction in the UTC days given (YYYY-MM-DD, both optional), as CSV text (R-108). */
      exportTransactions: build.query<string, { profileId: string; from?: string; to?: string }>({
        query: ({ profileId, ...params }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/transactions.csv`,
          params,
          responseHandler: "text",
        }),
        keepUnusedDataFor: 0,
      }),
    }),
  });

export const {
  useGetTransactionsQuery,
  useLabelTransactionMutation,
  useLazyExportTransactionsQuery,
} = transactionsApi;
