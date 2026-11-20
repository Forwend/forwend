import type { crossQuoteSchema, crossTokensSchema } from "@/features/pay/schemas/crosschain";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type PaySchemasMatchTheSpec = [
  Check<
    Accepts<typeof crossTokensSchema, ApiAnswer<"/v1/invoices/{payToken}/crosschain/tokens", "get">>
  >,
  Check<
    Accepts<typeof crossQuoteSchema, ApiAnswer<"/v1/invoices/{payToken}/crosschain/price", "get">>
  >,
  Check<
    Accepts<typeof crossQuoteSchema, ApiAnswer<"/v1/invoices/{payToken}/crosschain/quotes", "post">>
  >,
];
