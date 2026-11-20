import type { pendingSendsSchema, sendFeeSchema, sendSchema } from "@/features/send/schemas/send";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type SendSchemasMatchTheSpec = [
  Check<Accepts<typeof sendSchema, ApiAnswer<"/v1/profiles/{profileId}/sends", "post">>>,
  Check<
    Accepts<typeof sendSchema, ApiAnswer<"/v1/profiles/{profileId}/sends/{sendId}/approve", "post">>
  >,
  Check<
    Accepts<typeof sendSchema, ApiAnswer<"/v1/profiles/{profileId}/sends/{sendId}/submit", "post">>
  >,
  Check<Accepts<typeof pendingSendsSchema, ApiAnswer<"/v1/profiles/{profileId}/sends", "get">>>,
  Check<Accepts<typeof sendFeeSchema, ApiAnswer<"/v1/profiles/{profileId}/sends/fee", "get">>>,
  Check<Accepts<typeof sendSchema, ApiAnswer<"/v1/profiles/{profileId}/sends/{sendId}", "get">>>,
];
