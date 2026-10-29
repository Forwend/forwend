import type { z } from "zod";
import type {
  checkoutBodySchema,
  checkoutSessionSchema,
} from "@/features/checkout/schemas/checkout";

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;
