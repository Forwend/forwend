import { PAYMENT_PAGE_SIZE } from "@/features/payments/constants/payments";
import {
  attentionPageSchema,
  movementsPageSchema,
  paymentDetailSchema,
  paymentsPageSchema,
  reconciliationSchema,
} from "@/features/payments/schemas/payments";
import type {
  AttentionPage,
  Payment,
  PaymentDetail,
  PaymentFilters,
  PaymentMovementPage,
  PaymentPeriod,
  PaymentReconciliation,
} from "@/features/payments/types/payments";
import { apiSlice } from "@/shared/api/api-slice";

const path = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/payments`;
interface Query {
  profileId: string;
  filters?: PaymentFilters;
}
const TAG = "Payments";
export const paymentsApi = apiSlice.enhanceEndpoints({ addTagTypes: [TAG] }).injectEndpoints({
  endpoints: (build) => ({
    getPayments: build.infiniteQuery<
      { items: Payment[]; nextCursor: string | null },
      Query,
      string | null
    >({
      infiniteQueryOptions: { initialPageParam: null, getNextPageParam: (last) => last.nextCursor },
      query: ({ queryArg: { profileId, filters }, pageParam }) => ({
        url: path(profileId),
        params: {
          ...filters,
          limit: PAYMENT_PAGE_SIZE,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
      responseSchema: paymentsPageSchema,
      providesTags: [TAG],
    }),
    getPaymentAttention: build.infiniteQuery<AttentionPage, Query, string | null>({
      infiniteQueryOptions: { initialPageParam: null, getNextPageParam: (last) => last.nextCursor },
      query: ({ queryArg: { profileId, filters }, pageParam }) => ({
        url: `${path(profileId)}/attention`,
        params: {
          ...filters,
          limit: PAYMENT_PAGE_SIZE,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
      responseSchema: attentionPageSchema,
      providesTags: [TAG],
    }),
    getPayment: build.query<PaymentDetail, { profileId: string; paymentId: string }>({
      query: ({ profileId, paymentId }) => `${path(profileId)}/${encodeURIComponent(paymentId)}`,
      responseSchema: paymentDetailSchema,
      providesTags: [TAG],
    }),
    getPaymentMovements: build.infiniteQuery<
      PaymentMovementPage,
      { profileId: string; paymentId: string },
      string | null
    >({
      infiniteQueryOptions: { initialPageParam: null, getNextPageParam: (last) => last.nextCursor },
      query: ({ queryArg: { profileId, paymentId }, pageParam }) => ({
        url: `${path(profileId)}/${encodeURIComponent(paymentId)}/movements`,
        params: { limit: PAYMENT_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
      responseSchema: movementsPageSchema,
      providesTags: [TAG],
    }),
    getPaymentReconciliation: build.query<PaymentReconciliation, Query & PaymentPeriod>({
      query: ({ profileId, filters, ...period }) => ({
        url: `${path(profileId)}/reconciliation`,
        params: { ...filters, ...period },
      }),
      responseSchema: reconciliationSchema,
      providesTags: [TAG],
    }),
    exportPayments: build.query<string, Query & PaymentPeriod & { paymentId?: string }>({
      query: ({ profileId, filters, paymentId, ...period }) => ({
        url: paymentId
          ? `${path(profileId)}/${encodeURIComponent(paymentId)}/movements.csv`
          : `${path(profileId)}.csv`,
        params: { ...filters, ...period },
        responseHandler: (r) => (r.ok ? r.text() : r.json()),
      }),
      keepUnusedDataFor: 0,
    }),
  }),
});
export const {
  useGetPaymentsInfiniteQuery,
  useGetPaymentAttentionInfiniteQuery,
  useGetPaymentQuery,
  useGetPaymentMovementsInfiniteQuery,
  useGetPaymentReconciliationQuery,
  useLazyExportPaymentsQuery,
} = paymentsApi;
