import type { storeBodySchema, storeSchema, storesSchema } from "@/features/stores/schemas/stores";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type StoresSchemasMatchTheSpec = [
  Check<Accepts<typeof storesSchema, ApiAnswer<"/v1/profiles/{profileId}/stores", "get">>>,
  Check<Accepts<typeof storeSchema, ApiAnswer<"/v1/profiles/{profileId}/stores/{storeId}", "get">>>,
  Check<Accepts<typeof storeSchema, ApiAnswer<"/v1/profiles/{profileId}/stores/{storeId}", "put">>>,
  Check<Sends<typeof storeBodySchema, ApiBody<"/v1/profiles/{profileId}/stores/{storeId}", "put">>>,
  Check<
    Accepts<typeof storeSchema, ApiAnswer<"/v1/profiles/{profileId}/stores/{storeId}/logo", "put">>
  >,
  Check<
    Accepts<
      typeof storeSchema,
      ApiAnswer<"/v1/profiles/{profileId}/stores/{storeId}/logo", "delete">
    >
  >,
];
