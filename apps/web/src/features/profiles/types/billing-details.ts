import type { z } from "zod";
import type {
  billingDetailsBodySchema,
  billingDetailsSchema,
} from "@/features/profiles/schemas/profiles";
export type BillingDetails = z.infer<typeof billingDetailsSchema>;

export type BillingDetailsBody = z.infer<typeof billingDetailsBodySchema>;
