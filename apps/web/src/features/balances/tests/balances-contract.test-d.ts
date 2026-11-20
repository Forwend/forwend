import type { balanceHistorySchema, balancesSchema } from "@/features/balances/schemas/balances";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type BalancesSchemasMatchTheSpec = [
  Check<Accepts<typeof balancesSchema, ApiAnswer<"/v1/profiles/{profileId}/balances", "get">>>,
  Check<
    Accepts<
      typeof balanceHistorySchema,
      ApiAnswer<"/v1/profiles/{profileId}/balance-history", "get">
    >
  >,
];
