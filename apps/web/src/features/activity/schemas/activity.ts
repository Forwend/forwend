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
  paymentStatus: openEnum<ApiPaymentStatus>().optional(),
  confirming: z.boolean().optional(),
  at: apiTime,
  invoiceId: hash32,
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  status: openEnum<ApiPaymentStatus | ApiDepositStatus>(),
  settlementStatus: openEnum<ApiSettlementStatus>().optional(),
  txHash: hash32.optional(),
  // Above 1 the client chooses: the invoice reads in USD, not in the token given here (its first option).
  optionCount: z.number().int().positive(),
  // An invoice whose checkout closed and can no longer be paid, before its status catches up (R-77); false for a deposit.
  closed: z.boolean(),
  // A deposit the owner gets none of, held for the payer (D-26); false for an invoice.
  held: z.boolean(),
  // What tells rows apart: who paid and for what. Older reads leave them out.
  number: z.number().int().positive().nullable().optional(),
  reference: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  // A booked deposit split between the owner and the payer; null until booked and for an invoice.
  merchantAmount: baseUnits.nullable().optional(),
  heldAmount: baseUnits.nullable().optional(),
});

export const activityPageSchema = pageOf(activityItemSchema);
