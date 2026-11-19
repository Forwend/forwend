import { z } from "zod";
import {
  FEE_PAYERS,
  SEND_FAILURES,
  SEND_STATUSES,
  SEND_WARNINGS,
} from "@/features/send/constants/send";
import { apiTime, baseUnits, count, evmAddress } from "@/shared/schemas/api";

export const sendFeeSchema = z.object({ amount: baseUnits, paidBy: z.enum(FEE_PAYERS) });

export const sendSchema = z.object({
  sendId: z.guid(),
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  from: evmAddress,
  to: evmAddress,
  toProfileId: z.guid().nullable(),
  amount: baseUnits,
  status: z.enum(SEND_STATUSES),
  final: z.boolean(), // its block can no longer change
  txHash: z.string().nullable(),
  failure: z.enum(SEND_FAILURES).nullable(),
  networkFee: sendFeeSchema,
  gas: z // null unless the wallet pays its own gas
    .object({ limit: baseUnits, maxFeePerGas: baseUnits, maxPriorityFeePerGas: baseUnits })
    .nullable(),
  warnings: z.array(z.enum(SEND_WARNINGS)),
  createdAt: apiTime,
  privyRequest: z
    .object({
      url: z.string(),
      body: z.record(z.string(), z.unknown()),
      headers: z.record(z.string(), z.string()),
    })
    .optional(),
});

export const pendingSendsSchema = z.object({ sends: z.array(sendSchema) });
