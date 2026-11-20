import { z } from "zod";
import { ACTIVITY_KINDS } from "@/features/activity/constants/activity";
import {
  apiTime,
  baseUnits,
  count,
  evmAddress,
  hash32,
  openEnum,
  pageOf,
} from "@/shared/schemas/api";
import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/shared/types/payment-state";

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
  optionCount: z.number().int().positive(), // above 1, the amount is in USD
  closed: z.boolean(), // closed before its status says so
  held: z.boolean(), // none of it is the owner's
  number: z.number().int().positive().nullable().optional(),
  reference: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  merchantAmount: baseUnits.nullable().optional(),
  heldAmount: baseUnits.nullable().optional(),
});

export const activityPageSchema = pageOf(activityItemSchema);
