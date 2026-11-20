import type {
  clientSchema,
  clientsPageSchema,
  savedClientBodySchema,
} from "@/features/clients/schemas/clients";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type ClientsSchemasMatchTheSpec = [
  Check<Accepts<typeof clientsPageSchema, ApiAnswer<"/v1/profiles/{profileId}/clients", "get">>>,
  Check<
    Accepts<typeof clientSchema, ApiAnswer<"/v1/profiles/{profileId}/clients/{clientId}", "get">>
  >,
  Check<
    Accepts<typeof clientSchema, ApiAnswer<"/v1/profiles/{profileId}/clients/{clientId}", "put">>
  >,
  Check<
    Sends<
      typeof savedClientBodySchema,
      ApiBody<"/v1/profiles/{profileId}/clients/{clientId}", "put">
    >
  >,
];
