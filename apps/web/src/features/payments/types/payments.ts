import type { z } from "zod";
import type { PAYMENT_VIEWS } from "@/features/payments/constants/payments";
import type {
  attentionPageSchema,
  paymentDetailSchema,
  paymentProblemSchema,
  paymentSchema,
  reconciliationSchema,
} from "@/features/payments/schemas/payments";
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;
export type PaymentProblem = z.infer<typeof paymentProblemSchema>;
export type PaymentView = (typeof PAYMENT_VIEWS)[keyof typeof PAYMENT_VIEWS];
export type AttentionPage = z.infer<typeof attentionPageSchema>;
export type PaymentReconciliation = z.infer<typeof reconciliationSchema>;
export interface PaymentFilters {
  q?: string;
  storeId?: string;
  source?: Payment["source"];
  linkId?: string;
  status?: string;
  /** The derived payment state (D-114). */
  state?: string;
  /** The derived wallet transfer state (D-114). */
  wallet?: string;
  /** An exact order reference. */
  reference?: string;
}
export interface PaymentPeriod {
  from?: string;
  to?: string;
}
