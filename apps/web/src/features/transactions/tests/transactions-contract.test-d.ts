import type {
  recordsCurrencySchema,
  transactionsPageSchema,
} from "@/features/transactions/schemas/transactions";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type TransactionsSchemasMatchTheSpec = [
  Check<
    Accepts<
      typeof transactionsPageSchema,
      ApiAnswer<"/v1/profiles/{profileId}/transactions", "get">
    >
  >,
  Check<
    Accepts<
      typeof recordsCurrencySchema,
      ApiAnswer<"/v1/profiles/{profileId}/records-currency", "get">
    >
  >,
  Check<
    Accepts<
      typeof recordsCurrencySchema,
      ApiAnswer<"/v1/profiles/{profileId}/records-currency", "put">
    >
  >,
];
