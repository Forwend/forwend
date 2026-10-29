import { z } from "zod";
import { paymentSchema } from "@/features/payments/schemas/payments";

/** POST /v1/profiles/{id}/checkout-sessions: the fields the in-person checkout sends. */
export const checkoutBodySchema = z.object({
  storeId: z.guid(),
  amountUsd: z.string().min(1),
  reference: z.string().optional(),
  title: z.string().optional(),
});

/** A checkout session; its payment is the same record the Payments list reads. */
export const checkoutSessionSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  payment: paymentSchema,
});
