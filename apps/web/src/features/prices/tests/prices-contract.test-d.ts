import type { pricesSchema } from "@/features/prices/schemas/prices";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type PricesSchemasMatchTheSpec = [
  Check<Accepts<typeof pricesSchema, ApiAnswer<"/v1/prices", "get">>>,
];
