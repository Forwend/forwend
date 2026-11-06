import { z } from "zod";
import { apiTime, baseUnits, count, evmAddress, usdAmount } from "@/shared/schemas/api";

/** GET /v1/profiles/{id}/balances, TokenBalance. Amounts are base units. */
export const tokenBalanceSchema = z.object({
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  // null when the wallet balance could not be read.
  wallet: baseUnits.nullable(),
  finalizedBlock: count.nullable(),
  pending: baseUnits,
  held: baseUnits,
  // The parts of pending: paid and moving to the wallet, still confirming, and partly paid (may expire into held).
  settling: baseUnits.optional(),
  confirming: baseUnits.optional(),
  partial: baseUnits.optional(),
  livemode: z.boolean().optional(),
  // Forwend pays the gas on this chain, so Send offers it (D-119).
  sendable: z.boolean().optional(),
});

export const balancesSchema = z.object({
  tokens: z.array(tokenBalanceSchema),
  // At 1 USD per stablecoin; null when any balance is missing.
  estimatedUsdTotal: usdAmount.nullable(),
});

/** GET /v1/profiles/{id}/balance-history, BalanceHistoryPoint: the end of one UTC day; the last point is now. */
export const balanceHistoryPointSchema = z.object({
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
