import { TEAM_ERRORS } from "@/features/team/constants/team";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";

const EXPIRES = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatExpiry(at: string): string {
  return EXPIRES.format(new Date(at));
}

/** Where an invite or a role change's error shows: under the email, under the stores, or for the whole form. */
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
