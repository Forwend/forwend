import { z } from "zod";
import { apiTime, baseUnits, count, evmAddress, usdAmount } from "@/shared/schemas/api";

export const tokenBalanceSchema = z.object({
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  wallet: baseUnits.nullable(), // null when unread
  finalizedBlock: count.nullable(),
  pending: baseUnits,
  held: baseUnits,
  settling: baseUnits.optional(), // pending = settling + confirming + partial
  confirming: baseUnits.optional(),
  partial: baseUnits.optional(),
  livemode: z.boolean().optional(),
  sendable: z.boolean().optional(),
});

export const balancesSchema = z.object({
  tokens: z.array(tokenBalanceSchema),
  estimatedUsdTotal: usdAmount.nullable(), // at 1 USD per stablecoin
});

const balanceHistoryPointSchema = z.object({
  at: apiTime,
  estimatedUsd: usdAmount.nullable(),
  receivedUsd: usdAmount.nullable(),
  sentUsd: usdAmount.nullable(),
});

export const tokenHistorySchema = z.object({
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  balances: z.array(baseUnits).nullable(),
  received: z.array(baseUnits).nullable(),
  sent: z.array(baseUnits).nullable(),
});

export const balanceHistorySchema = z.object({
  points: z.array(balanceHistoryPointSchema),
  tokens: z.array(tokenHistorySchema),
});
