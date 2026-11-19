import { ROLES } from "@/features/profiles/constants/profile";
import { MEMBER_ROLES, TEAM_ERRORS } from "@/features/team/constants/team";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import type { GrantBody, MemberRole } from "@/features/team/types/team";

export function memberRole(role: string): MemberRole {
  return MEMBER_ROLES.find((r) => r === role) ?? ROLES.admin;
}

/** An Admin reaches every store, so names none; others need one. null when missing. */
export function grant(role: MemberRole, stores: readonly string[]): GrantBody | null {
  if (role === ROLES.admin) return { role, stores: [] };
  return stores.length > 0 ? { role, stores: [...stores] } : null;
}

export function grantError(failure: unknown): { email?: string; stores?: string; form?: string } {
  const { data } = failure as { data?: { error?: { code?: string; message?: string } } };
  const code = data?.error?.code;
  const message = data?.error?.message ?? "";
  if (code === TEAM_ERRORS.onTeam) return { email: COPY.errors.onTeam };
  if (code === TEAM_ERRORS.rateLimited) return { form: COPY.errors.rateLimited };
  if (code === TEAM_ERRORS.invalid && message.includes("email"))
    return { email: COPY.errors.email };
  if (code === TEAM_ERRORS.invalid && message.includes("stores"))
    return { stores: COPY.errors.stores };
  return { form: COPY.errors.failed };
}
