import {
  type CreateInvoiceBody,
  INVOICES_PAGE_SIZE,
  type Invoice,
  type InvoiceSummary,
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
      /** Newest first; "Show more" adds the next page, and a refresh reads every shown page again. */
      getInvoices: build.infiniteQuery<InvoicesPage, string, string | null>({
        infiniteQueryOptions: {
          initialPageParam: null,
          getNextPageParam: (last) => last.nextCursor,
        },
        query: ({ queryArg: profileId, pageParam }) => ({
          url: profileInvoices(profileId),
          params: { limit: INVOICES_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        }),
        providesTags: [INVOICES_TAG],
      }),
      /** Public: terms, statuses and deposits, without the client. */
      getInvoice: build.query<Invoice, string>({
        query: (invoiceId) => `/v1/invoices/${encodeURIComponent(invoiceId)}`,
      }),
      // The API has no owner read of one invoice, and only the owner's list carries the client. The list's cursor is
      // the number to list below (internal/invoice/list.go), so number + 1 with limit 1 is this invoice, if the profile
      // owns it.
      getProfileInvoice: build.query<InvoiceSummary | null, { profileId: string; number: number }>({
        query: ({ profileId, number }) => ({
          url: profileInvoices(profileId),
          params: { limit: 1, cursor: String(number + 1) },
        }),
        transformResponse: (page: InvoicesPage) => page.items[0] ?? null,
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
