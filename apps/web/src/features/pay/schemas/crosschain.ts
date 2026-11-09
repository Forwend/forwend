import { z } from "zod";
import { baseUnits, count } from "@/shared/schemas/api";

// GET /v1/invoices/{payToken}/crosschain/tokens and price, POST .../quotes (R-231, R-232).
export const crossTokenSchema = z.object({
  assetId: z.string(),
  blockchain: z.string(),
  symbol: z.string(),
  decimals: count,
  contract: z.string().nullable(),
  priceUsd: z.string(),
  // In the list only: about what the payer sends at the listed price.
  estimate: baseUnits.nullable(),
  // In the list only: the Base USDC base units NEAR Intents last needed at least (D-126); an older api leaves it out.
  minimum: baseUnits.nullable().optional(),
});

export const crossTokensSchema = z.object({
  due: baseUnits,
  decimals: count,
  tokens: z.array(crossTokenSchema),
});

// A price has no id, address, window or signature; a quote has them all.
export const crossQuoteSchema = z.object({
  quoteId: z.string().nullable(),
  token: crossTokenSchema,
  depositAddress: z.string().nullable(),
  amountIn: baseUnits,
  minAmountIn: baseUnits,
  amountOut: baseUnits,
  amountInUsd: z.string(),
  refundFee: z.string(),
  timeEstimate: z.number().nonnegative(),
  refundTo: z.string().nullable(),
  shownUntil: z.string().nullable(),
  deadline: z.string().nullable(),
  createdAt: z.string().nullable(),
  signed: z.unknown(),
});
