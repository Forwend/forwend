import { pendingSendsSchema, sendFeeSchema, sendSchema } from "@/features/send/schemas/send";
import type { Send, SendRequest } from "@/features/send/types/send";
import { apiSlice } from "@/shared/api/api-slice";

const sends = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/sends`;

export const sendApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    // Needs a fresh sign-in (D-49): the form that sends it shows the confirm step in place.
    prepareSend: build.mutation<Send, SendRequest>({
      query: ({ profileId, ...body }) => ({ url: sends(profileId), method: "POST", body }),
      responseSchema: sendSchema,
    }),
    submitSend: build.mutation<Send, { profileId: string; sendId: string; txHash: string }>({
      query: ({ profileId, sendId, txHash }) => ({
        url: `${sends(profileId)}/${encodeURIComponent(sendId)}/submit`,
        method: "POST",
        body: { txHash },
      }),
      responseSchema: sendSchema,
      // The money lists show it as Sending at once (R-215).
      invalidatesTags: ["PendingSends"],
    }),
    cancelSend: build.mutation<void, { profileId: string; sendId: string }>({
      query: ({ profileId, sendId }) => ({
        url: `${sends(profileId)}/${encodeURIComponent(sendId)}/cancel`,
        method: "POST",
      }),
    }),
    listPendingSends: build.query<{ sends: Send[] }, string>({
      query: (profileId) => sends(profileId),
      responseSchema: pendingSendsSchema,
      providesTags: ["PendingSends"],
    }),
    getSendFee: build.query<
      { amount: string; paidBy: string },
      { profileId: string; chainId: number; token: string }
    >({
      query: ({ profileId, chainId, token }) => ({
        url: `${sends(profileId)}/fee`,
        params: { chainId, token },
      }),
      responseSchema: sendFeeSchema,
    }),
    getSend: build.query<Send, { profileId: string; sendId: string }>({
      query: ({ profileId, sendId }) => `${sends(profileId)}/${encodeURIComponent(sendId)}`,
      responseSchema: sendSchema,
    }),
  }),
});

export const {
  usePrepareSendMutation,
  useSubmitSendMutation,
  useCancelSendMutation,
  useGetSendFeeQuery,
  useGetSendQuery,
  useListPendingSendsQuery,
} = sendApi;
