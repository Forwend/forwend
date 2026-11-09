import type { z } from "zod";
import type { CROSS_CHAIN_STATUSES } from "@/features/pay/constants/crosschain";
import type {
  crossQuoteSchema,
  crossTokenSchema,
  crossTokensSchema,
} from "@/features/pay/schemas/crosschain";

export type CrossChainStatus = (typeof CROSS_CHAIN_STATUSES)[keyof typeof CROSS_CHAIN_STATUSES];
export type CrossToken = z.infer<typeof crossTokenSchema>;
export type CrossTokens = z.infer<typeof crossTokensSchema>;
export type CrossQuote = z.infer<typeof crossQuoteSchema>;
