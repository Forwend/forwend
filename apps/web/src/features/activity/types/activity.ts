import type { z } from "zod";
import type {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
  STATUS_FILTERS,
} from "@/features/activity/constants/activity";
import type { activityItemSchema, activityPageSchema } from "@/features/activity/schemas/activity";

export type StatusFilter = (typeof STATUS_FILTERS)[keyof typeof STATUS_FILTERS];

export type ActivityKind = (typeof ACTIVITY_KINDS)[keyof typeof ACTIVITY_KINDS];

export type ApiPaymentStatus = (typeof API_PAYMENT_STATUSES)[keyof typeof API_PAYMENT_STATUSES];

export type ApiSettlementStatus =
  (typeof API_SETTLEMENT_STATUSES)[keyof typeof API_SETTLEMENT_STATUSES];

export type ApiDepositStatus = (typeof API_DEPOSIT_STATUSES)[keyof typeof API_DEPOSIT_STATUSES];

export type ActivityItem = z.infer<typeof activityItemSchema>;

export type ActivityPage = z.infer<typeof activityPageSchema>;
