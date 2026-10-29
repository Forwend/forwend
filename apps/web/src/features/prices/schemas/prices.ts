import { z } from "zod";
import { apiTime, count, evmAddress, usdAmount } from "@/shared/schemas/api";

/** GET /v1/prices, TokenPrice: CoinGecko's USD price of 1 token, for display only (R-178, D-115). */
export const tokenPriceSchema = z.object({
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  coinId: z.string().nullable(),
  // CoinGecko's exact decimal text; null without a price, never 1 in its place.
  usd: usdAmount.nullable(),
  sourceUpdatedAt: apiTime.nullable(),
  fetchedAt: apiTime.nullable(),
  stale: z.boolean(),
});

export const pricesSchema = z.object({ prices: z.array(tokenPriceSchema) });
