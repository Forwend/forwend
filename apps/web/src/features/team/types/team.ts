import type { z } from "zod";
import type { MEMBER_ROLES } from "@/features/team/constants/team";
import type {
  grantBodySchema,
  invitationSchema,
  inviteBodySchema,
  inviteSchema,
  memberSchema,
  teamSchema,
} from "@/features/team/schemas/team";

export type MemberRole = (typeof MEMBER_ROLES)[number];

export type Member = z.infer<typeof memberSchema>;

export type Invite = z.infer<typeof inviteSchema>;

export type Team = z.infer<typeof teamSchema>;

export type Invitation = z.infer<typeof invitationSchema>;

export type GrantBody = z.infer<typeof grantBodySchema>;

export type InviteBody = z.infer<typeof inviteBodySchema>;
