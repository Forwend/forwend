import { z } from "zod";
import { ACTIVITY_KINDS } from "@/features/activity/constants/activity";
import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/features/activity/types/activity";
import {
  apiTime,
  baseUnits,
  count,
  evmAddress,
  hash32,
  openEnum,
  pageOf,
} from "@/shared/schemas/api";

/** GET /v1/profiles/{id}/activity, ActivityItem. */
export const activityItemSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  at: apiTime,
  invoiceId: hash32,
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  // An invoice's payment status or a deposit's status; other values may come from a newer API.
  status: openEnum<ApiPaymentStatus | ApiDepositStatus>(),
  settlementStatus: openEnum<ApiSettlementStatus>().optional(),
  txHash: hash32.optional(),
  // Above 1 the client chooses: the invoice reads in USD, not in the token given here (its first option).
  optionCount: z.number().int().positive(),
  // Invoices only: when the checkout closes (R-77).
  expiresAt: apiTime.optional(),
});

export const activityPageSchema = pageOf(activityItemSchema);
