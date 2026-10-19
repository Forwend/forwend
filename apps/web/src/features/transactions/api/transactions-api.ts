import {
  recordsCurrencySchema,
  transactionsPageSchema,
} from "@/features/transactions/schemas/transactions";
import type {
  RecordsCurrencySetting,
  Transaction,
  TransactionDirection,
  TransactionLabel,
  TransactionsPage,
} from "@/features/transactions/types/transactions";
import { apiSlice } from "@/shared/api/api-slice";

const TRANSACTIONS_TAG = "Transactions";
const RECORDS_CURRENCY_TAG = "RecordsCurrency";

export const transactionsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [TRANSACTIONS_TAG, RECORDS_CURRENCY_TAG] })
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
      /** The profile's other records currency (R-110), null for none. */
      getRecordsCurrency: build.query<RecordsCurrencySetting, string>({
        query: (profileId) => `/v1/profiles/${encodeURIComponent(profileId)}/records-currency`,
        responseSchema: recordsCurrencySchema,
        providesTags: [RECORDS_CURRENCY_TAG],
      }),
      /** Sets it, null for none; the transactions read again with their values in it. */
      setRecordsCurrency: build.mutation<
        RecordsCurrencySetting,
        { profileId: string } & RecordsCurrencySetting
      >({
        query: ({ profileId, currency }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/records-currency`,
          method: "PUT",
          body: { currency },
        }),
        responseSchema: recordsCurrencySchema,
        invalidatesTags: [TRANSACTIONS_TAG, RECORDS_CURRENCY_TAG],
      }),
      /**
       * The income statement of the UTC days given, both required (R-112). The PDF comes back as an object URL for the
       * caller to save and revoke, so no file sits in the store; an error stays the API's JSON.
       */
      downloadStatement: build.mutation<string, { profileId: string; from: string; to: string }>({
        query: ({ profileId, from, to }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/statement.pdf`,
          params: { from, to },
          responseHandler: async (response) =>
            response.ok ? URL.createObjectURL(await response.blob()) : response.json(),
        }),
      }),
      /** Every transaction in the UTC days given (YYYY-MM-DD, both optional), as CSV text (R-108); an error stays JSON. */
      exportTransactions: build.query<string, { profileId: string; from?: string; to?: string }>({
        query: ({ profileId, ...params }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/transactions.csv`,
          params,
          responseHandler: (response) => (response.ok ? response.text() : response.json()),
        }),
        keepUnusedDataFor: 0,
      }),
    }),
  });

export const {
  useGetTransactionsQuery,
  useLabelTransactionMutation,
  useLazyExportTransactionsQuery,
  useGetRecordsCurrencyQuery,
  useSetRecordsCurrencyMutation,
  useDownloadStatementMutation,
} = transactionsApi;
