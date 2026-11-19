import { TRANSACTIONS_PAGE_SIZE } from "@/features/transactions/constants/transactions";
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

export const recordsCurrencySaveKey = (profileId: string): string =>
  `records-currency:${profileId}`;

export const transactionsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [TRANSACTIONS_TAG, RECORDS_CURRENCY_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
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
      getTransactionPages: build.infiniteQuery<
        TransactionsPage,
        { profileId: string; direction?: TransactionDirection; q?: string },
        string | null
      >({
        infiniteQueryOptions: {
          initialPageParam: null,
          getNextPageParam: (last) => last.nextCursor,
        },
        query: ({ queryArg: { profileId, ...params }, pageParam }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/transactions`,
          params: {
            ...params,
            limit: TRANSACTIONS_PAGE_SIZE,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
        responseSchema: transactionsPageSchema,
        providesTags: [TRANSACTIONS_TAG],
      }),
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
      getRecordsCurrency: build.query<RecordsCurrencySetting, string>({
        query: (profileId) => `/v1/profiles/${encodeURIComponent(profileId)}/records-currency`,
        responseSchema: recordsCurrencySchema,
        providesTags: [RECORDS_CURRENCY_TAG],
      }),
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
      // An object URL the caller saves and revokes, so no file sits in the store.
      downloadStatement: build.mutation<string, { profileId: string; from: string; to: string }>({
        query: ({ profileId, from, to }) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/statement.pdf`,
          params: { from, to },
          responseHandler: async (response) =>
            response.ok ? URL.createObjectURL(await response.blob()) : response.json(),
        }),
      }),
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
  useGetTransactionPagesInfiniteQuery,
  useLabelTransactionMutation,
  useLazyExportTransactionsQuery,
  useGetRecordsCurrencyQuery,
  useSetRecordsCurrencyMutation,
  useDownloadStatementMutation,
} = transactionsApi;
