import { z } from "zod";
import {
  deliveriesSchema,
  endpointBodySchema,
  endpointSchema,
  endpointsSchema,
  resentSchema,
  secretsSchema,
  testSentSchema,
} from "@/features/webhooks/schemas/webhooks";
import type {
  Delivery,
  EndpointBody,
  WebhookEndpoint,
  WebhookSecret,
} from "@/features/webhooks/types/webhooks";
import { apiSlice } from "@/shared/api/api-slice";

const ENDPOINTS_TAG = "WebhookEndpoints";
const DELIVERIES_TAG = "WebhookDeliveries";

const hooksUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/webhooks`;
const hookUrl = (profileId: string, endpointId: string) =>
  `${hooksUrl(profileId)}/${encodeURIComponent(endpointId)}`;

type EndpointArg = { profileId: string; endpointId: string };
const endpointArg = z.object({ profileId: z.guid(), endpointId: z.guid() });

// R-149: saving an endpoint and revealing or rotating its secret ask for a fresh sign-in first (D-63).
export const webhooksApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [ENDPOINTS_TAG, DELIVERIES_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      listEndpoints: build.query<WebhookEndpoint[], string>({
        query: (profileId) => hooksUrl(profileId),
        rawResponseSchema: endpointsSchema,
        transformResponse: (data: { endpoints: WebhookEndpoint[] }) => data.endpoints,
        providesTags: [ENDPOINTS_TAG],
      }),
      saveEndpoint: build.mutation<WebhookEndpoint, EndpointArg & { body: EndpointBody }>({
        query: ({ profileId, endpointId, body }) => ({
          url: hookUrl(profileId, endpointId),
          method: "PUT",
          body,
        }),
        argSchema: endpointArg.extend({ body: endpointBodySchema }),
        responseSchema: endpointSchema,
        // Turning an endpoint on sends what waited for it.
        invalidatesTags: [ENDPOINTS_TAG, DELIVERIES_TAG],
      }),
      deleteEndpoint: build.mutation<void, EndpointArg>({
        query: ({ profileId, endpointId }) => ({
          url: hookUrl(profileId, endpointId),
          method: "DELETE",
        }),
        argSchema: endpointArg,
        invalidatesTags: [ENDPOINTS_TAG],
      }),
      // A mutation, not a query, so the secrets leave the store once shown (as API keys do).
      revealSecrets: build.mutation<WebhookSecret[], EndpointArg>({
        query: ({ profileId, endpointId }) => `${hookUrl(profileId, endpointId)}/secret`,
        argSchema: endpointArg,
        rawResponseSchema: secretsSchema,
        transformResponse: (data: { secrets: WebhookSecret[] }) => data.secrets,
      }),
      rotateSecret: build.mutation<WebhookSecret[], EndpointArg>({
        query: ({ profileId, endpointId }) => ({
          url: `${hookUrl(profileId, endpointId)}/secret/rotate`,
          method: "POST",
        }),
        argSchema: endpointArg,
        rawResponseSchema: secretsSchema,
        transformResponse: (data: { secrets: WebhookSecret[] }) => data.secrets,
      }),
      listDeliveries: build.query<Delivery[], EndpointArg>({
        query: ({ profileId, endpointId }) => `${hookUrl(profileId, endpointId)}/deliveries`,
        rawResponseSchema: deliveriesSchema,
        transformResponse: (data: { deliveries: Delivery[] }) => data.deliveries,
        providesTags: [DELIVERIES_TAG],
      }),
      resendDelivery: build.mutation<void, EndpointArg & { eventId: string }>({
        query: ({ profileId, endpointId, eventId }) => ({
          url: `${hookUrl(profileId, endpointId)}/deliveries/${encodeURIComponent(eventId)}/resend`,
          method: "POST",
        }),
        invalidatesTags: [DELIVERIES_TAG],
      }),
      resendFailed: build.mutation<number, EndpointArg & { since: string }>({
        query: ({ profileId, endpointId, since }) => ({
          url: `${hookUrl(profileId, endpointId)}/deliveries/resend-failed`,
          method: "POST",
          body: { since },
        }),
        argSchema: endpointArg.extend({ since: z.iso.datetime() }),
        rawResponseSchema: resentSchema,
        transformResponse: (data: { resent: number }) => data.resent,
        invalidatesTags: [DELIVERIES_TAG],
      }),
      sendTest: build.mutation<string, EndpointArg>({
        query: ({ profileId, endpointId }) => ({
          url: `${hookUrl(profileId, endpointId)}/test`,
          method: "POST",
        }),
        argSchema: endpointArg,
        rawResponseSchema: testSentSchema,
        transformResponse: (data: { eventId: string }) => data.eventId,
        invalidatesTags: [DELIVERIES_TAG],
      }),
    }),
  });

export const {
  useListEndpointsQuery,
  useSaveEndpointMutation,
  useDeleteEndpointMutation,
  useRevealSecretsMutation,
  useRotateSecretMutation,
  useListDeliveriesQuery,
  useResendDeliveryMutation,
  useResendFailedMutation,
  useSendTestMutation,
} = webhooksApi;
