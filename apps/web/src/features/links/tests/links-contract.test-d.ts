import type {
  linkBodySchema,
  linkPaySchema,
  linkSchema,
  linksPageSchema,
  publicLinkSchema,
} from "@/features/links/schemas/links";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type LinksSchemasMatchTheSpec = [
  Check<Accepts<typeof linksPageSchema, ApiAnswer<"/v1/profiles/{profileId}/links", "get">>>,
  Check<Accepts<typeof linkSchema, ApiAnswer<"/v1/profiles/{profileId}/links/{linkId}", "get">>>,
  Check<Accepts<typeof linkSchema, ApiAnswer<"/v1/profiles/{profileId}/links/{linkId}", "put">>>,
  Check<Sends<typeof linkBodySchema, ApiBody<"/v1/profiles/{profileId}/links/{linkId}", "put">>>,
  Check<Accepts<typeof publicLinkSchema, ApiAnswer<"/v1/links/{slug}", "get">>>,
  Check<Accepts<typeof linkPaySchema, ApiAnswer<"/v1/links/{slug}/pay", "post">>>,
];
