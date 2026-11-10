import type { z } from "zod";
import type { activityItemSchema, activityPageSchema } from "@/features/activity/schemas/activity";
import type {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/shared/constants/payment-state";

export type ApiPaymentStatus = (typeof API_PAYMENT_STATUSES)[keyof typeof API_PAYMENT_STATUSES];

export type ApiSettlementStatus =
  (typeof API_SETTLEMENT_STATUSES)[keyof typeof API_SETTLEMENT_STATUSES];

export type ApiDepositStatus = (typeof API_DEPOSIT_STATUSES)[keyof typeof API_DEPOSIT_STATUSES];

export type ActivityItem = z.infer<typeof activityItemSchema>;

export type ActivityPage = z.infer<typeof activityPageSchema>;
