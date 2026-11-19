import type { z } from "zod";
import type { BALANCE_FIELDS } from "@/features/balances/constants/balances";
import type { balancesSchema, tokenBalanceSchema } from "@/features/balances/schemas/balances";

export type TokenBalance = z.infer<typeof tokenBalanceSchema>;

export type Balances = z.infer<typeof balancesSchema>;

export type BalanceField = (typeof BALANCE_FIELDS)[keyof typeof BALANCE_FIELDS];
