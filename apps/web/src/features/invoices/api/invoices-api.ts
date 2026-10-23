import { z } from "zod";
import type { StatusFilter } from "@/features/activity/types/activity";
import { INVOICES_PAGE_SIZE } from "@/features/invoices/constants/invoices";
import {
  createInvoiceBodySchema,
  invoiceEventsSchema,
  invoiceSchema,
  invoicesPageSchema,
  owedListSchema,
  recheckSchema,
  stoppedRemindersSchema,
} from "@/features/invoices/schemas/invoices";
import type {
  CreateInvoiceBody,
  Invoice,
  InvoiceEvent,
  InvoicesPage,
  Owed,
  Recheck,
  StoppedReminders,
} from "@/features/invoices/types/invoices";
import { apiSlice } from "@/shared/api/api-slice";

const INVOICES_TAG = "Invoices";

const profileInvoices = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/invoices`;

export const invoicesApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [INVOICES_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
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
      /** Public, by the pay link's token; without the client. */
      getInvoice: build.query<Invoice, string>({
        query: (payToken) => `/v1/invoices/${encodeURIComponent(payToken)}`,
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
      /** The bell's events (R-81), newest first. */
      getInvoiceEvents: build.query<InvoiceEvent[], string>({
        query: (profileId) => ({
          url: `/v1/profiles/${encodeURIComponent(profileId)}/events`,
          params: { limit: 20 },
        }),
        rawResponseSchema: invoiceEventsSchema,
        transformResponse: (data: { items: InvoiceEvent[] }) => data.items,
      }),
      /** Owed to you (R-95). */
      getOwed: build.query<Owed[], string>({
        query: (profileId) => `/v1/profiles/${encodeURIComponent(profileId)}/owed`,
        rawResponseSchema: owedListSchema,
        transformResponse: (data: { items: Owed[] }) => data.items,
        providesTags: [INVOICES_TAG],
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
      /** R-94: one email per idempotency key; 409 when it can't be sent, 429 past a send limit. */
      sendInvoice: build.mutation<
        Invoice,
        { profileId: string; invoiceId: string; idempotencyKey: string }
      >({
        // A day's limit is the answer, not something to wait out.
        extraOptions: { answerFirst: true },
        query: ({ profileId, invoiceId, idempotencyKey }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/send`,
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** R-96: on is 409 once unpayable, without a due date or client email, or after the client stopped them. */
      setReminders: build.mutation<Invoice, { profileId: string; invoiceId: string; on: boolean }>({
        query: ({ profileId, invoiceId, on }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/reminders`,
          method: "PUT",
          body: { on },
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** R-127, R-128: the whole editable set; null clears a field. 409 when a locked one changes. */
      editInvoice: build.mutation<
        Invoice,
        {
          profileId: string;
          invoiceId: string;
          body: {
            memo: string | null;
            clientEmail: string | null;
            returnUrl: string | null;
            reference: string | null;
            note: string | null;
            dueDate: string | null;
          };
        }
      >({
        query: ({ profileId, invoiceId, body }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/details`,
          method: "PUT",
          body,
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** Stops the invoice's retainer (R-98); the same answer twice, also for an invoice that doesn't repeat. */
      stopRepeat: build.mutation<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/repeat/stop`,
          method: "POST",
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** The client's stop link (R-96): public, the same answer twice; 404 for a link that is not one. */
      stopReminders: build.mutation<StoppedReminders, string>({
        query: (token) => ({
          url: `/v1/reminders/${encodeURIComponent(token)}/stop`,
          method: "POST",
        }),
        responseSchema: stoppedRemindersSchema,
      }),
      /** Check status: public, like the checkout read; the api allows one per invoice every 5 minutes. */
      recheckInvoice: build.mutation<Recheck, string>({
        // Asked too soon is the answer: the page rests until the next check, it does not wait and ask again.
        extraOptions: { answerFirst: true },
        query: (payToken) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/recheck`,
          method: "POST",
        }),
        responseSchema: recheckSchema,
      }),
      /** One pay page load (R-125): public; a refused count is not sent again. */
      countView: build.mutation<void, string>({
        extraOptions: { answerFirst: true },
        query: (payToken) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/views`,
          method: "POST",
        }),
      }),
      /** Email me the receipt (R-82): public, like the checkout; 409 once the receipt went out. */
      setPayerEmail: build.mutation<{ email: string }, { payToken: string; email: string }>({
        query: ({ payToken, email }) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/payer-email`,
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
  useSendInvoiceMutation,
  useSetRemindersMutation,
  useStopRepeatMutation,
  useStopRemindersMutation,
  useGetInvoiceEventsQuery,
  useGetOwedQuery,
  useRecheckInvoiceMutation,
  useSetPayerEmailMutation,
  useCountViewMutation,
  useEditInvoiceMutation,
} = invoicesApi;
