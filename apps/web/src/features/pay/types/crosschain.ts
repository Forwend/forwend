import type { z } from "zod";
import type {
  crossQuoteSchema,
  crossTokenSchema,
  crossTokensSchema,
} from "@/features/pay/schemas/crosschain";

export type CrossToken = z.infer<typeof crossTokenSchema>;
export type CrossTokens = z.infer<typeof crossTokensSchema>;
export type CrossQuote = z.infer<typeof crossQuoteSchema>;
