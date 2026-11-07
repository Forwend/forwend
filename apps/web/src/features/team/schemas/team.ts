import { z } from "zod";
import { ROLES } from "@/features/profiles/constants/profile";
import { MEMBER_ROLES } from "@/features/team/constants/team";
import { apiTime } from "@/shared/schemas/api";

/** PUT /v1/profiles/{profileId}/members/{memberId}: a role, and a Developer's or Finance member's stores (R-139). */
export const grantBodySchema = z.object({ role: z.enum(MEMBER_ROLES), stores: z.array(z.guid()) });

/** POST /v1/profiles/{profileId}/invites. */
export const inviteBodySchema = grantBodySchema.extend({ email: z.string() });

/** What a member who lost access could still use, for the owner to roll (D-93). */
export const toRollSchema = z.object({
  keys: z.array(z.object({ keyId: z.guid(), name: z.string(), last4: z.string() })),
  webhooks: z.array(z.object({ endpointId: z.guid(), url: z.string() })),
});

/** The owner or a member (apps/backend/api/openapi.yaml, Member); email is null when the account has none. */
export const memberSchema = z.object({
  memberId: z.guid(),
  email: z.string().nullable(),
  role: z.enum(ROLES),
  stores: z.array(z.guid()),
  createdAt: apiTime,
  // Set on a role change that left an Admin with less.
  toRoll: toRollSchema.optional(),
});

/** An open invite: not accepted, revoked or expired. */
export const inviteSchema = z.object({
  inviteId: z.guid(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  stores: z.array(z.guid()),
  createdAt: apiTime,
  expiresAt: apiTime,
});

/** GET /v1/profiles/{profileId}/members: the owner first, then the members, and the open invites. */
export const teamSchema = z.object({
  members: z.array(memberSchema),
  invites: z.array(inviteSchema),
});

/** GET /v1/invites/{token}: what the invite link shows the user who opens it. */
export const invitationSchema = z.object({
  profileName: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  expiresAt: apiTime,
});

/** POST /v1/invites/{token}/accept. */
export const acceptedSchema = z.object({ profileId: z.guid() });
