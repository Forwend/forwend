import { z } from "zod";
import type { StatusFilter } from "@/features/activity/types/activity";
import { INVOICES_PAGE_SIZE } from "@/features/invoices/constants/invoices";
import {
  createInvoiceBodySchema,
  invoiceEventsSchema,
  invoiceSchema,
  invoicesPageSchema,
  recheckSchema,
} from "@/features/invoices/schemas/invoices";
import type {
  CreateInvoiceBody,
  Invoice,
  InvoiceEvent,
  InvoicesPage,
  Recheck,
} from "@/features/invoices/types/invoices";
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
        responseSchema: invoicesPageSchema,
        providesTags: [INVOICES_TAG],
      }),
      /** Public: terms, statuses and deposits, without the client. */
      getInvoice: build.query<Invoice, string>({
        query: (invoiceId) => `/v1/invoices/${encodeURIComponent(invoiceId)}`,
        responseSchema: invoiceSchema,
        providesTags: [INVOICES_TAG],
      }),
      /** The owner's read: the public one plus the client; 404 for another profile's invoice. */
      getProfileInvoice: build.query<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) =>
          `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}`,
        responseSchema: invoiceSchema,
        providesTags: [INVOICES_TAG],
      }),
      /** The bell's events (R-81): paid, settled and held money, newest first. */
      getInvoiceEvents: build.query<InvoiceEvent[], string>({
        query: (profileId) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/events`,
          params: { limit: 20 },
        }),
        rawResponseSchema: invoiceEventsSchema,
        transformResponse: (data: { items: InvoiceEvent[] }) => data.items,
      }),
      /** Cancel before any money (R-79): 409 once money was seen or the checkout closed. */
      cancelInvoice: build.mutation<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/cancel`,
          method: "POST",
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** Check status: public, like the checkout read; the api allows one per invoice every 5 minutes. */
      recheckInvoice: build.mutation<Recheck, string>({
        // Asked too soon is the answer: the page rests until the next check, it does not wait and ask again.
        extraOptions: { answerFirst: true },
        query: (invoiceId) => ({
          url: `/v1/invoices/${encodeURIComponent(invoiceId)}/recheck`,
          method: "POST",
        }),
        responseSchema: recheckSchema,
      }),
      /** Email me the receipt (R-82): public, like the checkout; 409 once the receipt went out. */
      setPayerEmail: build.mutation<{ email: string }, { invoiceId: string; email: string }>({
        query: ({ invoiceId, email }) => ({
          url: `/v1/invoices/${encodeURIComponent(invoiceId)}/payer-email`,
          method: "PUT",
          body: { email },
        }),
        responseSchema: z.object({ email: z.string() }),
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
        argSchema: z.object({
          profileId: z.guid(),
          idempotencyKey: z.string().min(1),
          body: createInvoiceBodySchema,
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
    }),
  });

export const {
  useGetInvoicesInfiniteQuery,
  useGetInvoiceQuery,
  useGetProfileInvoiceQuery,
  useCreateInvoiceMutation,
  useCancelInvoiceMutation,
  useGetInvoiceEventsQuery,
  useRecheckInvoiceMutation,
  useSetPayerEmailMutation,
} = invoicesApi;
