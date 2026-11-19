import { z } from "zod";
import { baseUnits, count } from "@/shared/schemas/api";

export const crossTokenSchema = z.object({
  assetId: z.string(),
  blockchain: z.string(),
  symbol: z.string(),
  decimals: count,
  contract: z.string().nullable(),
  priceUsd: z.string(),
  estimate: baseUnits.nullable(),
  minimum: baseUnits.nullable().optional(),
  coingeckoId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .nullable()
    .optional(),
});

export const crossTokensSchema = z.object({
  due: baseUnits,
  decimals: count,
  tokens: z.array(crossTokenSchema),
});

export const crossQuoteSchema = z.object({
  quoteId: z.string().nullable(),
  token: crossTokenSchema,
  depositAddress: z.string().nullable(),
  amountIn: baseUnits,
  minAmountIn: baseUnits,
  amountOut: baseUnits,
  amountInUsd: z.string(),
  amountOutUsd: z.string(),
  refundFee: z.string(),
  timeEstimate: z.number().nonnegative(),
  refundTo: z.string().nullable(),
  shownUntil: z.string().nullable(),
  deadline: z.string().nullable(),
  createdAt: z.string().nullable(),
  signed: z.unknown(),
});
