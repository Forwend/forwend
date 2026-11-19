import { z } from "zod";
import { paymentSchema } from "@/features/payments/schemas/payments";

export const checkoutBodySchema = z.object({
  storeId: z.guid(),
  amountUsd: z.string().min(1),
  reference: z.string().optional(),
  title: z.string().optional(),
});

export const checkoutSessionSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  payment: paymentSchema,
});
