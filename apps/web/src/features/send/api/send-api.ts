import { pendingSendsSchema, sendFeeSchema, sendSchema } from "@/features/send/schemas/send";
import type { Send, SendFee, SendRequest } from "@/features/send/types/send";
import { apiSlice } from "@/shared/api/api-slice";

const sends = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/sends`;

export const sendApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    prepareSend: build.mutation<Send, SendRequest>({
      query: ({ profileId, ...body }) => ({ url: sends(profileId), method: "POST", body }),
      responseSchema: sendSchema,
    }),
    approveSend: build.mutation<Send, { profileId: string; sendId: string }>({
      query: ({ profileId, sendId }) => ({
        url: `${sends(profileId)}/${encodeURIComponent(sendId)}/approve`,
        method: "POST",
      }),
      responseSchema: sendSchema,
    }),
    submitSend: build.mutation<
      Send,
      { profileId: string; sendId: string } & ({ txHash: string } | { signature: string })
    >({
      query: ({ profileId, sendId, ...body }) => ({
        url: `${sends(profileId)}/${encodeURIComponent(sendId)}/submit`,
        method: "POST",
        body,
      }),
      responseSchema: sendSchema,
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
      SendFee,
      { profileId: string; chainId: number; token: string; to: string }
    >({
      query: ({ profileId, chainId, token, to }) => ({
        url: `${sends(profileId)}/fee`,
        params: { chainId, token, to },
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
  useApproveSendMutation,
  useSubmitSendMutation,
  useCancelSendMutation,
  useGetSendFeeQuery,
  useGetSendQuery,
  useListPendingSendsQuery,
} = sendApi;
