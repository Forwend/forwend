import type {
  checkoutBodySchema,
  checkoutSessionSchema,
} from "@/features/checkout/schemas/checkout";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type CheckoutSchemasMatchTheSpec = [
  Check<
    Accepts<
      typeof checkoutSessionSchema,
      ApiAnswer<"/v1/profiles/{profileId}/checkout-sessions", "post">
    >
  >,
  Check<
    Sends<typeof checkoutBodySchema, ApiBody<"/v1/profiles/{profileId}/checkout-sessions", "post">>
  >,
  Check<
    Accepts<
      typeof checkoutSessionSchema,
      ApiAnswer<"/v1/profiles/{profileId}/checkout-sessions/{sessionId}/expire", "post">
    >
  >,
];
