import type {
  deliveriesSchema,
  endpointBodySchema,
  endpointSchema,
  endpointsSchema,
  resentSchema,
  secretsSchema,
  testSentSchema,
} from "@/features/webhooks/schemas/webhooks";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type WebhooksSchemasMatchTheSpec = [
  Check<Accepts<typeof endpointsSchema, ApiAnswer<"/v1/profiles/{profileId}/webhooks", "get">>>,
  Check<
    Accepts<
      typeof endpointSchema,
      ApiAnswer<"/v1/profiles/{profileId}/webhooks/{endpointId}", "put">
    >
  >,
  Check<
    Sends<
      typeof endpointBodySchema,
      ApiBody<"/v1/profiles/{profileId}/webhooks/{endpointId}", "put">
    >
  >,
  Check<
    Accepts<
      typeof secretsSchema,
      ApiAnswer<"/v1/profiles/{profileId}/webhooks/{endpointId}/secret", "get">
    >
  >,
  Check<
    Accepts<
      typeof secretsSchema,
      ApiAnswer<"/v1/profiles/{profileId}/webhooks/{endpointId}/secret/rotate", "post">
    >
  >,
  Check<
    Accepts<
      typeof deliveriesSchema,
      ApiAnswer<"/v1/profiles/{profileId}/webhooks/{endpointId}/deliveries", "get">
    >
  >,
  Check<
    Accepts<
      typeof resentSchema,
      ApiAnswer<"/v1/profiles/{profileId}/webhooks/{endpointId}/deliveries/resend-failed", "post">
    >
  >,
  Check<
    Accepts<
      typeof testSentSchema,
      ApiAnswer<"/v1/profiles/{profileId}/webhooks/{endpointId}/test", "post">
    >
  >,
];
