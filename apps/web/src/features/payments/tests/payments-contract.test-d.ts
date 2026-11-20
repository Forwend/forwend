import type {
  attentionPageSchema,
  paymentDetailSchema,
  paymentsPageSchema,
  reconciliationSchema,
} from "@/features/payments/schemas/payments";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type PaymentsSchemasMatchTheSpec = [
  Check<Accepts<typeof paymentsPageSchema, ApiAnswer<"/v1/profiles/{profileId}/payments", "get">>>,
  Check<
    Accepts<
      typeof attentionPageSchema,
      ApiAnswer<"/v1/profiles/{profileId}/payments/attention", "get">
    >
  >,
  Check<
    Accepts<
      typeof paymentDetailSchema,
      ApiAnswer<"/v1/profiles/{profileId}/payments/{paymentId}", "get">
    >
  >,
  Check<
    Accepts<
      typeof reconciliationSchema,
      ApiAnswer<"/v1/profiles/{profileId}/payments/reconciliation", "get">
    >
  >,
];
