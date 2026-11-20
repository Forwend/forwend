import { z } from "zod";
import { INVOICES_PAGE_SIZE } from "@/features/invoices/constants/invoices";
import {
  createInvoiceBodySchema,
  feeQuoteSchema,
  invoiceEventsSchema,
  invoiceSchema,
  invoicesPageSchema,
  owedListSchema,
  payerEmailSchema,
  recheckSchema,
  stoppedRemindersSchema,
} from "@/features/invoices/schemas/invoices";
import type {
  CreateInvoiceBody,
  FeeQuote,
  Invoice,
  InvoiceEvent,
  InvoicesPage,
  OwedList,
  Recheck,
  StoppedReminders,
} from "@/features/invoices/types/invoices";
import type { FeesPaidBy } from "@/features/profiles/types/profile";
import { apiSlice, profilePath } from "@/shared/api/api-slice";
import type { ApiBody } from "@/shared/types/api-contract";
import type { ApiPaymentState } from "@/shared/types/payment-state";

export const INVOICES_TAG = "Invoices";

const profileInvoices = (profileId: string) => profilePath(profileId, "invoices");

export const invoicesApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [INVOICES_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      getInvoices: build.infiniteQuery<
        InvoicesPage,
        { profileId: string; state?: ApiPaymentState; q?: string },
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
      /** With the client; 404 for another profile's invoice. */
      getProfileInvoice: build.query<
        Invoice,
        { profileId: string; invoiceId: string; summary?: boolean }
      >({
        query: ({ profileId, invoiceId, summary }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}`,
          params: summary ? { view: "summary" } : undefined,
        }),
        responseSchema: invoiceSchema,
        providesTags: [INVOICES_TAG],
      }),
      /** Newest first. */
      getInvoiceEvents: build.query<InvoiceEvent[], string>({
        query: (profileId) => ({
          url: profilePath(profileId, "events"),
          params: { limit: 20 },
        }),
        rawResponseSchema: invoiceEventsSchema,
        transformResponse: (data: { items: InvoiceEvent[] }) => data.items,
      }),
      getFees: build.query<
        FeeQuote,
        { profileId: string; storeId?: string; feesPaidBy: FeesPaidBy } & (
          | { amountUsd: string }
          | { chainId: number; token: string; amount: string }
        )
      >({
        query: ({ profileId, ...price }) => ({
          url: profilePath(profileId, "fees"),
          params: price,
        }),
        responseSchema: feeQuoteSchema,
      }),
      getOwed: build.query<OwedList, string>({
        query: (profileId) => profilePath(profileId, "owed"),
        responseSchema: owedListSchema,
        providesTags: [INVOICES_TAG],
      }),
      /** 409 once money was seen or the checkout closed. */
      cancelInvoice: build.mutation<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/cancel`,
          method: "POST",
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** Once, while reopenUntil is set; 409 otherwise. */
      reopenInvoice: build.mutation<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/reopen`,
          method: "POST",
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** One email per idempotency key; 409 when it can't be sent, 429 past a send limit. */
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
      /** on is 409 once unpayable, without a due date or client email, or once the client stopped them. */
      setReminders: build.mutation<Invoice, { profileId: string; invoiceId: string; on: boolean }>({
        query: ({ profileId, invoiceId, on }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/reminders`,
          method: "PUT",
          body: { on } satisfies ApiBody<
            "/v1/profiles/{profileId}/invoices/{invoiceId}/reminders",
            "put"
          >,
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** The whole editable set; null clears a field. 409 when a locked one changes. */
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
          body: body satisfies ApiBody<
            "/v1/profiles/{profileId}/invoices/{invoiceId}/details",
            "put"
          >,
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** The same answer twice, also for an invoice that doesn't repeat. */
      stopRepeat: build.mutation<Invoice, { profileId: string; invoiceId: string }>({
        query: ({ profileId, invoiceId }) => ({
          url: `${profileInvoices(profileId)}/${encodeURIComponent(invoiceId)}/repeat/stop`,
          method: "POST",
        }),
        responseSchema: invoiceSchema,
        invalidatesTags: [INVOICES_TAG],
      }),
      /** Public; the same answer twice; 404 for a link that is not one. */
      stopReminders: build.mutation<StoppedReminders, string>({
        query: (token) => ({
          url: `/v1/reminders/${encodeURIComponent(token)}/stop`,
          method: "POST",
        }),
        responseSchema: stoppedRemindersSchema,
      }),
      /** Public; the API allows one per invoice every 5 minutes. */
      recheckInvoice: build.mutation<Recheck, string>({
        // Asked too soon is the answer: the page rests until the next check.
        extraOptions: { answerFirst: true },
        query: (payToken) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/recheck`,
          method: "POST",
        }),
        responseSchema: recheckSchema,
      }),
      /** Public; a refused count is not sent again. */
      countView: build.mutation<void, string>({
        extraOptions: { answerFirst: true },
        query: (payToken) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/views`,
          method: "POST",
        }),
      }),
      /** Public; 409 once the receipt went out. */
      setPayerEmail: build.mutation<{ email: string }, { payToken: string; email: string }>({
        query: ({ payToken, email }) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/payer-email`,
          method: "PUT",
          body: { email } satisfies ApiBody<"/v1/invoices/{payToken}/payer-email", "put">,
        }),
        responseSchema: payerEmailSchema,
      }),
      /** Public; 409 once money is seen, which the next read shows. */
      pickOption: build.mutation<void, { payToken: string; optionId: string }>({
        query: ({ payToken, optionId }) => ({
          url: `/v1/invoices/${encodeURIComponent(payToken)}/pick`,
          method: "PUT",
          body: { optionId } satisfies ApiBody<"/v1/invoices/{payToken}/pick", "put">,
        }),
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
  useLazyGetInvoiceQuery,
  useGetProfileInvoiceQuery,
  useCreateInvoiceMutation,
  useCancelInvoiceMutation,
  useReopenInvoiceMutation,
  useSendInvoiceMutation,
  useSetRemindersMutation,
  useStopRepeatMutation,
  useStopRemindersMutation,
  useGetInvoiceEventsQuery,
  useGetOwedQuery,
  useGetFeesQuery,
  useRecheckInvoiceMutation,
  useSetPayerEmailMutation,
  usePickOptionMutation,
  useCountViewMutation,
  useEditInvoiceMutation,
} = invoicesApi;
