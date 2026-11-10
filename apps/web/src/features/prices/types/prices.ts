import type { z } from "zod";
import type { pricesSchema, tokenPriceSchema } from "@/features/prices/schemas/prices";

export type TokenPrice = z.infer<typeof tokenPriceSchema>;

export type Prices = z.infer<typeof pricesSchema>;

/** An amount of one token in its base units. */
export interface TokenAmount {
  chainId: number;
  token: string;
  baseUnits: bigint;
  decimals: number;
}
