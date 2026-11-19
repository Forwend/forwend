import { ROLES } from "@/features/profiles/constants/profile";

export const MEMBER_ROLES = [ROLES.admin, ROLES.developer, ROLES.finance] as const;

export const TEAM_ERRORS = {
  invalid: "invalid_value",
  onTeam: "already_on_team",
  otherEmail: "invite_for_another_email",
  rateLimited: "rate_limited",
} as const;

export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
