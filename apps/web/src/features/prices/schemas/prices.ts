import { z } from "zod";
import { apiTime, count, evmAddress, usdAmount } from "@/shared/schemas/api";

export const tokenPriceSchema = z.object({
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  coinId: z.string().nullable(),
  usd: usdAmount.nullable(), // exact decimal text; null without a price
  sourceUpdatedAt: apiTime.nullable(),
  fetchedAt: apiTime.nullable(),
  stale: z.boolean(),
});

export const pricesSchema = z.object({ prices: z.array(tokenPriceSchema) });
