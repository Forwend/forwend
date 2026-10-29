import { z } from "zod";
import { checkoutBodySchema, checkoutSessionSchema } from "@/features/checkout/schemas/checkout";
import type { CheckoutBody, CheckoutSession } from "@/features/checkout/types/checkout";
import { PAYMENTS_TAG } from "@/features/payments/api/payments-api";
import { apiSlice } from "@/shared/api/api-slice";

const sessionsUrl = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/checkout-sessions`;

export const checkoutApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [PAYMENTS_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      /** One session per idempotency key, so a retried tap never charges twice. */
      createCheckout: build.mutation<
        CheckoutSession,
        { profileId: string; idempotencyKey: string; body: CheckoutBody }
      >({
        query: ({ profileId, idempotencyKey, body }) => ({
          url: sessionsUrl(profileId),
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        }),
        argSchema: z.object({
          profileId: z.guid(),
          idempotencyKey: z.string().min(1),
          body: checkoutBodySchema,
        }),
        responseSchema: checkoutSessionSchema,
        // A new checkout shows on the Payments list and the overview.
        invalidatesTags: [PAYMENTS_TAG],
      }),
      /** 409 once a payment is seen: the customer has paid or is paying. */
      expireCheckout: build.mutation<CheckoutSession, { profileId: string; sessionId: string }>({
        query: ({ profileId, sessionId }) => ({
          url: `${sessionsUrl(profileId)}/${encodeURIComponent(sessionId)}/expire`,
          method: "POST",
        }),
        responseSchema: checkoutSessionSchema,
        invalidatesTags: [PAYMENTS_TAG],
      }),
    }),
  });

export const { useCreateCheckoutMutation, useExpireCheckoutMutation } = checkoutApi;
