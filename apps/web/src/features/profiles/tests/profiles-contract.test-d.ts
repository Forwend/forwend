import type {
  billingDetailsBodySchema,
  billingDetailsSchema,
  createProfileBodySchema,
  meSchema,
  notificationsSchema,
  profileFeesSchema,
  profileModeSchema,
  profileSchema,
  profileTokensSchema,
} from "@/features/profiles/schemas/profiles";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type ProfilesSchemasMatchTheSpec = [
  Check<Accepts<typeof meSchema, ApiAnswer<"/v1/me", "post">>>,
  Check<Accepts<typeof profileSchema, ApiAnswer<"/v1/profiles", "post">>>,
  Check<Sends<typeof createProfileBodySchema, ApiBody<"/v1/profiles", "post">>>,
  Check<
    Accepts<
      typeof billingDetailsSchema,
      ApiAnswer<"/v1/profiles/{profileId}/billing-details", "get">
    >
  >,
  Check<
    Accepts<
      typeof billingDetailsSchema,
      ApiAnswer<"/v1/profiles/{profileId}/billing-details", "put">
    >
  >,
  Check<
    Sends<
      typeof billingDetailsBodySchema,
      ApiBody<"/v1/profiles/{profileId}/billing-details", "put">
    >
  >,
  Check<
    Accepts<typeof notificationsSchema, ApiAnswer<"/v1/profiles/{profileId}/notifications", "get">>
  >,
  Check<
    Accepts<typeof notificationsSchema, ApiAnswer<"/v1/profiles/{profileId}/notifications", "put">>
  >,
  Check<Accepts<typeof profileModeSchema, ApiAnswer<"/v1/profiles/{profileId}/mode", "put">>>,
  Check<Accepts<typeof profileFeesSchema, ApiAnswer<"/v1/profiles/{profileId}/fees", "put">>>,
  Check<Accepts<typeof profileTokensSchema, ApiAnswer<"/v1/profiles/{profileId}/tokens", "get">>>,
  Check<Accepts<typeof profileTokensSchema, ApiAnswer<"/v1/profiles/{profileId}/tokens", "put">>>,
];
