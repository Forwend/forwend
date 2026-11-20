import { z } from "zod";
import { ROLES } from "@/features/profiles/constants/profile";
import { MEMBER_ROLES } from "@/features/team/constants/team";
import { apiTime } from "@/shared/schemas/api";

export const grantBodySchema = z.object({ role: z.enum(MEMBER_ROLES), stores: z.array(z.guid()) });

export const inviteBodySchema = grantBodySchema.extend({ email: z.string() });

export const toRollSchema = z.object({
  keys: z.array(z.object({ keyId: z.guid(), name: z.string(), last4: z.string() })),
  webhooks: z.array(z.object({ endpointId: z.guid(), url: z.string() })),
});

export const removedMemberSchema = z.object({ toRoll: toRollSchema });

export const memberSchema = z.object({
  memberId: z.guid(),
  email: z.string().nullable(), // null when the account has none
  role: z.enum(ROLES),
  stores: z.array(z.guid()),
  createdAt: apiTime,
  toRoll: toRollSchema.optional(),
});

export const inviteSchema = z.object({
  inviteId: z.guid(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  stores: z.array(z.guid()),
  createdAt: apiTime,
  expiresAt: apiTime,
});

export const teamSchema = z.object({
  members: z.array(memberSchema),
  invites: z.array(inviteSchema),
});

export const invitationSchema = z.object({
  profileName: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  expiresAt: apiTime,
});

export const acceptedSchema = z.object({ profileId: z.guid() });
