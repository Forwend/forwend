import type { z } from "zod";
import type { balancesSchema, tokenBalanceSchema } from "@/features/balances/schemas/balances";
export type TokenBalance = z.infer<typeof tokenBalanceSchema>;

export type Balances = z.infer<typeof balancesSchema>;
