import type { StatusFilter } from "@/features/activity/activity";
import {
  type CreateInvoiceBody,
  INVOICES_PAGE_SIZE,
  type Invoice,
  type InvoicesPage,
} from "@/features/invoices/invoices";
import { apiSlice } from "@/shared/api/api-slice";

const INVOICES_TAG = "Invoices";

const profileInvoices = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/invoices`;

export const invoicesApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [INVOICES_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      /**
       * Newest first, under the status filter and search (none when left out); "Show more" adds the next page of the
       * same filtered list, and a refresh reads every shown page again.
       */
      getInvoices: build.infiniteQuery<
        InvoicesPage,
        { profileId: string; status?: StatusFilter; q?: string },
        string | null
      >({
        infiniteQueryOptions: {
          initialPageParam: null,
          getNextPageParam: (last) => last.nextCursor,
        },
        query: ({ queryArg: { profileId, ...filters }, pageParam }) => ({
          url: profileInvoices(profileId),
          params: {
            limit: INVOICES_PAGE_SIZE,
            ...filters,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
        providesTags: [INVOICES_TAG],
      }),
      /** Public: terms, statuses and deposits, without the client. */
      getInvoice: build.query<Invoice, string>({
        query: (invoiceId) => `/v1/invoices/${encodeURIComponent(invoiceId)}`,
      }),
      /** The owner's read: the public one plus the client; 404 for another profile's invoice. */
      getProfileInvoice: build.query<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) =>
          `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}`,
      }),
      /** One invoice per idempotency key, so a retried request never makes two. */
      createInvoice: build.mutation<
        Invoice,
        { profileId: string; idempotencyKey: string; body: CreateInvoiceBody }
      >({
        query: ({ profileId, idempotencyKey, body }) => ({
          url: profileInvoices(profileId),
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        }),
        invalidatesTags: [INVOICES_TAG],
      }),
    }),
  });

export const {
  useGetInvoicesInfiniteQuery,
  useGetInvoiceQuery,
  useGetProfileInvoiceQuery,
  useCreateInvoiceMutation,
} = invoicesApi;
