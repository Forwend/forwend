import type {
  acceptedSchema,
  grantBodySchema,
  invitationSchema,
  inviteBodySchema,
  inviteSchema,
  memberSchema,
  removedMemberSchema,
  teamSchema,
} from "@/features/team/schemas/team";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type TeamSchemasMatchTheSpec = [
  Check<Accepts<typeof teamSchema, ApiAnswer<"/v1/profiles/{profileId}/members", "get">>>,
  Check<Accepts<typeof inviteSchema, ApiAnswer<"/v1/profiles/{profileId}/invites", "post">>>,
  Check<Sends<typeof inviteBodySchema, ApiBody<"/v1/profiles/{profileId}/invites", "post">>>,
  Check<
    Accepts<typeof memberSchema, ApiAnswer<"/v1/profiles/{profileId}/members/{memberId}", "put">>
  >,
  Check<
    Sends<typeof grantBodySchema, ApiBody<"/v1/profiles/{profileId}/members/{memberId}", "put">>
  >,
  Check<
    Accepts<
      typeof removedMemberSchema,
      ApiAnswer<"/v1/profiles/{profileId}/members/{memberId}", "delete">
    >
  >,
  Check<Accepts<typeof invitationSchema, ApiAnswer<"/v1/invites/{token}", "get">>>,
  Check<Accepts<typeof acceptedSchema, ApiAnswer<"/v1/invites/{token}/accept", "post">>>,
];
