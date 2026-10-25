import { ROLES } from "@/features/profiles/constants/profile";

/** The roles an invite or a change gives; the owner is who made the profile, an Admin for good (D-93). */
export const MEMBER_ROLES = [ROLES.admin, ROLES.developer, ROLES.finance] as const;

/** The API's error codes the team pages answer (apps/backend/api/openapi.yaml). */
export const TEAM_ERRORS = {
  invalid: "invalid_value",
  onTeam: "already_on_team",
  otherEmail: "invite_for_another_email",
  rateLimited: "rate_limited",
} as const;

/** An invite link's token: 32 random bytes in hex; the API keeps only its hash (R-139). */
export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
